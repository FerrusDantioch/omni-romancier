// =====================================================================
// SERVICE WORKER : l'application fonctionne sans connexion (et sans serveur)
//
// Une « réserve » du navigateur garde une copie complète de l'application.
//   - À chaque ouverture d'Omni-Romancier, la page demande de rafraîchir cette réserve :
//     tous les fichiers sont retéléchargés et vérifiés, puis enregistrés ensemble.
//     S'il en manque un, ou si ce n'est pas Omni-Romancier qui répond, on garde l'ancienne copie.
//   - Quand un fichier de l'application est demandé : version fraîche si le serveur répond
//     (une modification, par exemple de css/theme.css, se voit tout de suite),
//     sinon la copie en réserve (l'application démarre même sans serveur).
// Seuls les fichiers d'Omni-Romancier sont concernés : un autre site ouvert à la même adresse
// (localhost:8000) passe sans être touché, et ne peut rien remplacer dans la réserve.
//
// Exception : le dictionnaire du correcteur orthographique (gros fichier, dont le nom change avec sa
// version) est téléchargé une seule fois, puis toujours pris dans la réserve (voir DURABLES).
//
// Les romans, eux, ne sont jamais ici : ils sont dans la base IndexedDB.
// =====================================================================

// Version de l'application (la même que dans js/app.js, affichée dans « À propos »).
// La changer à chaque publication : le navigateur voit alors un service worker modifié et
// l'installe aussitôt, et la réserve est entièrement retéléchargée.
const VERSION = "1.10.0";
const RESERVE = "omni-romancier";
const DELAI_RESEAU = 4000;   // au-delà (connexion très lente), on prend la copie en réserve
const PAUSE_RESEAU = 15000;  // serveur injoignable : pendant ce temps, on ne le redemande plus
const MARQUE = 'id="vue-bibliotheque"'; // preuve que la page reçue est bien celle d'Omni-Romancier

// Tous les fichiers de l'application (à compléter si l'on en ajoute un)
const FICHIERS = [
  "index.html",
  "manifest.json",
  "css/theme.css",
  "css/app.css",
  "css/impression.css",
  "correcteur/correcteur.css",
  "correcteur/correcteur.js",
  "correcteur/moteur.js",
  "correcteur/travailleur.js",
  "correcteur/bulle.js",
  "correcteur/liste.js",
  "correcteur/mots-fr-7.5.txt",
  "correcteur/LICENCE-dictionnaire.txt",
  "commun/saut-de-page.js",
  "js/app.js",
  "js/annulation.js",
  "js/bibliotheque.js",
  "js/db.js",
  "js/dialogues.js",
  "js/editeur.js",
  "js/etat.js",
  "js/export-pdf.js",
  "js/export-fichiers.js",
  "js/frise.js",
  "js/fusion.js",
  "js/hors-ligne.js",
  "js/onglets.js",
  "js/orthographe.js",
  "js/outils.js",
  "js/panneau.js",
  "js/plan.js",
  "js/recherche.js",
  "js/remplacer.js",
  "js/reperage.js",
  "js/sauvegarde.js",
  "js/surlignage.js",
  "js/zip.js",
  "fonts/oxanium.woff2",
  "fonts/literata.woff2",
  "fonts/literata-italique.woff2",
  "fonts/jetbrains-mono.woff2",
  "assets/logo.png",
  "assets/logo-rond.png",
  "assets/favicon.png",
  "assets/icone-192.png",
  "assets/icone-512.png",
  "assets/icone-maskable-512.png",
];

// Fichiers téléchargés une seule fois : on ne les retélécharge pas à chaque ouverture, et on les
// prend toujours dans la réserve (leur nom change quand leur contenu change)
const DURABLES = ["correcteur/mots-fr-7.5.txt"];

// Adresses complètes (le dossier de l'application peut être n'importe où)
const adresse = (f) => new URL(f, self.location).href;
const ADRESSES = new Set(FICHIERS.map(adresse));
const ADRESSES_DURABLES = new Set(DURABLES.map(adresse));
const ANCIEN_DICTIONNAIRE = /\/correcteur\/mots-[^/]*\.txt$/;
const ACCUEIL = adresse("./");
const PAGE = adresse("index.html");

// Le bon type des fichiers que le navigateur vérifie strictement, quoi qu'en dise le serveur
// (certains Windows annoncent les .js comme du simple texte : l'application ne démarrerait pas)
const TYPES = {
  html: [/^text\/html/i, "text/html; charset=utf-8"],
  js: [/javascript|ecmascript/i, "text/javascript; charset=utf-8"],
  css: [/^text\/css/i, "text/css; charset=utf-8"],
};

let injoignableJusqua = 0;   // voir PAUSE_RESEAU

// Installation : on remplit déjà la réserve (sans bloquer si c'est impossible : la page
// redemandera, et dira dans « À propos » ce qui ne va pas)
self.addEventListener("install", (e) => {
  e.waitUntil(actualiser().catch(() => {}).then(() => self.skipWaiting()));
});

// Activation : on supprime les éventuelles anciennes réserves d'Omni-Romancier, y compris celles
// de l'époque où l'application s'appelait « L'Atelier » (noms en « atelier… ») (seulement les siennes :
// d'autres sites publiés à la même adresse, par exemple sur GitHub Pages, peuvent avoir les leurs),
// et on prend en charge la page ouverte
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom !== RESERVE && (nom.startsWith("atelier") || nom.startsWith("omni-romancier"))) await caches.delete(nom);
    await self.clients.claim();
  })());
});

// La page demande de rafraîchir la réserve, et attend le bilan
self.addEventListener("message", (e) => {
  if (e.data !== "actualiser" || !e.ports[0]) return;
  e.waitUntil(actualiser().then((b) => e.ports[0].postMessage(b)));
});

// Retélécharge toute l'application, vérifie, puis remplace la réserve d'un seul coup
async function actualiser() {
  let erreur = null;
  try {
    const reserve = await caches.open(RESERVE);
    const aTelecharger = [];
    for (const f of FICHIERS) {
      if (!(ADRESSES_DURABLES.has(adresse(f)) && await reserve.match(adresse(f)))) aTelecharger.push(f);
    }
    const recus = await Promise.all(aTelecharger.map(telecharger));
    await Promise.all(recus.map(([f, reponse]) => reserve.put(f, reponse)));
    // Un dictionnaire d'une ancienne version : il ne sert plus
    for (const r of await reserve.keys()) if (ANCIEN_DICTIONNAIRE.test(r.url) && !ADRESSES.has(r.url)) await reserve.delete(r);
    injoignableJusqua = 0;
  } catch (err) {
    erreur = err.message;
  }
  return bilan(erreur);
}

async function telecharger(f) {
  let reponse;
  try {
    // (toujours le fichier lui-même, jamais une copie : une simple vérification par la date du fichier
    // laisserait passer un fichier remplacé par un plus ancien, ou un autre site servi à la même adresse)
    reponse = await fetch(f, { cache: "no-store" });
  } catch {
    throw new Error("le serveur ne répond pas");
  }
  if (!reponse.ok || reponse.redirected) throw new Error("fichier introuvable : " + f);
  reponse = await avecLeBonType(reponse, adresse(f));
  if (f === "index.html" && !(await reponse.clone().text()).includes(MARQUE)) {
    throw new Error("la page reçue n'est pas Omni-Romancier (le serveur est-il lancé depuis le bon dossier ?)");
  }
  // Le fichier est reçu EN ENTIER avant d'aller plus loin : la réserve n'est touchée qu'une fois tous les
  // fichiers arrivés (une connexion coupée au milieu d'un fichier ne laisse pas une réserve à moitié neuve)
  const corps = await reponse.blob();
  return [f, new Response(corps, { status: reponse.status, statusText: reponse.statusText, headers: reponse.headers })];
}

// La réserve contient-elle toute l'application ?
async function bilan(erreur) {
  const reserve = await caches.open(RESERVE);
  const presents = new Set((await reserve.keys()).map((r) => r.url));
  const manquants = FICHIERS.filter((f) => !presents.has(adresse(f)));
  return { complete: manquants.length === 0, erreur };
}

// Chaque fichier demandé
self.addEventListener("fetch", (e) => {
  const demande = e.request;
  if (demande.method !== "GET") return;
  const url = new URL(demande.url);
  url.search = "";
  url.hash = "";
  const page = demande.mode === "navigate";
  const cle = page && url.href === ACCUEIL ? PAGE : url.href;
  // Ce n'est pas un fichier d'Omni-Romancier : le navigateur s'en occupe seul
  if (page ? cle !== PAGE : !ADRESSES.has(cle)) return;
  e.respondWith(repondre(demande, cle));
});

async function repondre(demande, cle) {
  const copie = () => caches.match(cle, { cacheName: RESERVE });
  // Le dictionnaire : la copie en réserve s'il y en a une (inutile de retélécharger 2 Mo)
  if (ADRESSES_DURABLES.has(cle)) {
    const enReserve = await copie();
    if (enReserve) return enReserve;
  }
  // Le serveur n'a pas répondu à l'ouverture de la page : inutile de le réessayer pour chacun
  // des fichiers qui suivent (sur Windows, chaque essai peut prendre deux secondes).
  // L'ouverture de la page, elle, réessaie toujours.
  if (demande.mode !== "navigate" && Date.now() < injoignableJusqua) {
    const enReserve = await copie();
    if (enReserve) return enReserve;
  }
  try {
    // 1. Version fraîche, si le serveur répond assez vite
    const reponse = await avecDelai(fetch(demande, { cache: "no-store" }), DELAI_RESEAU);
    injoignableJusqua = 0;
    if (reponse.ok) return avecLeBonType(reponse, cle);
    // Le serveur répond, mais n'a pas ce fichier (autre dossier servi ?) : la copie, s'il y en a une
    return (await copie()) ?? reponse;
  } catch {
    // 2. Pas de réponse : la copie en réserve
    injoignableJusqua = Date.now() + PAUSE_RESEAU;
    return (await copie()) ?? new Response("Hors ligne : ce fichier n'est pas disponible.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// Corrige le type annoncé par le serveur s'il ne convient pas
async function avecLeBonType(reponse, url) {
  const chemin = new URL(url).pathname;
  const extension = chemin.endsWith("/") ? "html" : chemin.split(".").pop();
  const attendu = TYPES[extension];
  if (!attendu || attendu[0].test(reponse.headers.get("Content-Type") || "")) return reponse;
  const entetes = new Headers(reponse.headers);
  entetes.set("Content-Type", attendu[1]);
  return new Response(await reponse.blob(), {
    status: reponse.status, statusText: reponse.statusText, headers: entetes,
  });
}

// Abandonne une attente trop longue
function avecDelai(promesse, ms) {
  return new Promise((ok, echec) => {
    const minuterie = setTimeout(() => echec(new Error("trop lent")), ms);
    promesse.then((r) => { clearTimeout(minuterie); ok(r); }, (err) => { clearTimeout(minuterie); echec(err); });
  });
}
