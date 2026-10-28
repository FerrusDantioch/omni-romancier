// =====================================================================
// SERVICE WORKER : l'application fonctionne sans connexion (et sans serveur)
//
// Une « réserve » du navigateur garde une copie complète de l'application : c'est elle qui sert
// chaque fichier (l'application démarre même sans serveur ni connexion).
//   - À chaque ouverture d'Omni-Romancier, la page demande de vérifier la réserve : tous les fichiers
//     sont retéléchargés et vérifiés. La toute première fois, ils remplissent la réserve.
//   - Ensuite, si les fichiers reçus diffèrent de ceux de la réserve, c'est une NOUVELLE VERSION : elle
//     est mise de côté, entière, dans une réserve d'attente, et la page propose « Mettre à jour ».
//     Elle ne remplace la réserve qu'après cet appui : rien ne change par surprise, même après avoir
//     fermé et rouvert l'application.
//   - S'il manque un fichier, ou si ce n'est pas Omni-Romancier qui répond, on garde la copie actuelle.
// Seuls les fichiers d'Omni-Romancier sont concernés : un autre site ouvert à la même adresse
// (localhost:8000) passe sans être touché, et ne peut rien remplacer dans la réserve.
//
// Exception : le dictionnaire du correcteur orthographique (gros fichier, dont le nom change avec sa
// version) est téléchargé une seule fois, puis toujours pris dans la réserve (voir DURABLES).
//
// Les romans, eux, ne sont jamais ici : ils sont dans la base IndexedDB.
// =====================================================================

// Version de l'application (la même que dans js/app.js, affichée dans « À propos »).
// La changer à chaque publication, pour s'y retrouver (la nouvelle version est de toute façon
// repérée en comparant les fichiers, voir verifier()).
const VERSION = "1.11.0";
const RESERVE = "omni-romancier";
const ATTENTE = "omni-romancier-attente";   // la nouvelle version, qui attend « Mettre à jour »
const COMPLETE = "__attente-complete__";     // déposée en dernier : la réserve d'attente est entière
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
const ADRESSE_COMPLETE = adresse(COMPLETE);

// Le bon type des fichiers que le navigateur vérifie strictement, quoi qu'en dise le serveur
// (certains Windows annoncent les .js comme du simple texte : l'application ne démarrerait pas)
const TYPES = {
  html: [/^text\/html/i, "text/html; charset=utf-8"],
  js: [/javascript|ecmascript/i, "text/javascript; charset=utf-8"],
  css: [/^text\/css/i, "text/css; charset=utf-8"],
};

// Installation : on remplit déjà la réserve, ou on prépare la nouvelle version (sans bloquer si
// c'est impossible : la page redemandera, et dira dans « À propos » ce qui ne va pas).
// skipWaiting : ce petit programme prend le relais tout de suite, mais il continue de servir la
// réserve actuelle ; une nouvelle version des fichiers attend toujours « Mettre à jour ».
self.addEventListener("install", (e) => {
  e.waitUntil(verifier().catch(() => {}).then(() => self.skipWaiting()));
});

// Activation : on supprime les éventuelles anciennes réserves d'Omni-Romancier, y compris celles
// de l'époque où l'application s'appelait « L'Atelier » (noms en « atelier… ») (seulement les siennes :
// d'autres sites publiés à la même adresse, par exemple sur GitHub Pages, peuvent avoir les leurs),
// et on prend en charge la page ouverte
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) {
      if (nom !== RESERVE && nom !== ATTENTE && (nom.startsWith("atelier") || nom.startsWith("omni-romancier"))) await caches.delete(nom);
    }
    await self.clients.claim();
  })());
});

// La page demande de vérifier la réserve (« verifier »), ou de passer à la nouvelle version
// (« appliquer », après l'appui sur « Mettre à jour »), et attend le bilan
self.addEventListener("message", (e) => {
  if (!e.ports[0]) return;
  if (e.data === "verifier" || e.data === "actualiser") e.waitUntil(verifier().then((b) => e.ports[0].postMessage(b)));
  if (e.data === "appliquer") e.waitUntil(appliquer().then((b) => e.ports[0].postMessage(b)));
});

// Retélécharge toute l'application et vérifie. La toute première fois, remplit la réserve.
// Ensuite, une version différente est mise de côté dans la réserve d'attente (jamais à moitié).
async function verifier() {
  let erreur = null;
  try {
    const reserve = await caches.open(RESERVE);
    const enService = (await bilan(null)).complete;
    const aTelecharger = [];
    for (const f of FICHIERS) {
      if (!(ADRESSES_DURABLES.has(adresse(f)) && await reserve.match(adresse(f)))) aTelecharger.push(f);
    }
    const recus = await Promise.all(aTelecharger.map(telecharger));
    if (!enService) {
      // Réserve vide ou incomplète : il n'y a pas encore de version « en service » à protéger
      await Promise.all(recus.map(([f, reponse]) => reserve.put(f, reponse)));
      await retirerAnciensDictionnaires(reserve);
      await caches.delete(ATTENTE);
    } else if (await identiques(reserve, recus)) {
      // Rien de nouveau (ou le site est revenu à la version en service)
      await caches.delete(ATTENTE);
    } else {
      const attente = await caches.open(ATTENTE);
      if (!(await identiques(attente, recus)) || !(await attente.match(ADRESSE_COMPLETE))) {
        await caches.delete(ATTENTE);
        const neuve = await caches.open(ATTENTE);
        await Promise.all(recus.map(([f, reponse]) => neuve.put(f, reponse)));
        await neuve.put(ADRESSE_COMPLETE, new Response("complète"));
      }
    }
  } catch (err) {
    erreur = err.message;
  }
  return bilan(erreur);
}

// « Mettre à jour » : les fichiers de la réserve d'attente remplacent ceux de la réserve
async function appliquer() {
  const attente = await caches.open(ATTENTE);
  if (await attente.match(ADRESSE_COMPLETE)) {
    const reserve = await caches.open(RESERVE);
    for (const demande of await attente.keys()) {
      if (demande.url !== ADRESSE_COMPLETE) await reserve.put(demande, await attente.match(demande));
    }
    await retirerAnciensDictionnaires(reserve);
  }
  await caches.delete(ATTENTE);
  return bilan(null);
}

// Les fichiers reçus sont-ils exactement ceux de cette réserve ?
async function identiques(reserve, recus) {
  for (const [f, reponse] of recus) {
    const copie = await reserve.match(adresse(f));
    if (!copie) return false;
    const [a, b] = await Promise.all([copie.arrayBuffer(), reponse.clone().arrayBuffer()]);
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a), y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

// Un dictionnaire d'une ancienne version : il ne sert plus
async function retirerAnciensDictionnaires(reserve) {
  for (const r of await reserve.keys()) if (ANCIEN_DICTIONNAIRE.test(r.url) && !ADRESSES.has(r.url)) await reserve.delete(r);
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

// La réserve contient-elle toute l'application ? Une nouvelle version attend-elle ?
async function bilan(erreur) {
  const reserve = await caches.open(RESERVE);
  const presents = new Set((await reserve.keys()).map((r) => r.url));
  const manquants = FICHIERS.filter((f) => !presents.has(adresse(f)));
  const nouvelleVersion = Boolean(await (await caches.open(ATTENTE)).match(ADRESSE_COMPLETE));
  return { complete: manquants.length === 0, erreur, nouvelleVersion };
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
  // 1. La copie en réserve : c'est elle qui fait foi (une nouvelle version attend « Mettre à jour »)
  const enReserve = await caches.match(cle, { cacheName: RESERVE });
  if (enReserve) return enReserve;
  // 2. Pas encore en réserve (toute première ouverture) : le serveur
  try {
    const reponse = await fetch(demande, { cache: "no-store" });
    return reponse.ok ? avecLeBonType(reponse, cle) : reponse;
  } catch {
    return new Response("Hors ligne : ce fichier n'est pas disponible.", {
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
