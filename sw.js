// =====================================================================
// SERVICE WORKER — Cache versionné atomique (Omni-Romancier)
// =====================================================================

importScripts("js/config.js");

const CACHE_PREFIX = "omni-romancier-";
const CACHE_APP = CACHE_PREFIX + "v" + self.CONFIG_APP.version;
const CACHE_DICO = "omni-romancier-dico-v7.5";
const DICTIONNAIRE = "correcteur/mots-fr-7.5.txt";

const CACHES_HERITES = new Set([
  "omni-romancier",
  "omni-romancier-attente",
  "atelier",
  "atelier-romans",
]);

const FICHIERS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "fonts/OFL.txt",
  "correcteur/LICENCE-dictionnaire.txt",
  "css/theme.css",
  "css/app.css",
  "css/impression.css",
  "correcteur/correcteur.css",
  "correcteur/correcteur.js",
  "correcteur/moteur.js",
  "correcteur/travailleur.js",
  "correcteur/bulle.js",
  "correcteur/liste.js",
  "commun/saut-de-page.js",
  "js/config.js",
  "js/secours-demarrage.js",
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
  "assets/apple-touch-icon.png",
  "assets/icone-192.png",
  "assets/icone-512.png",
  "assets/icone-maskable-192.png",
  "assets/icone-maskable-512.png",
];

const SCOPE_URL = new URL(self.registration ? self.registration.scope : "./", self.location);
const SCOPE_PATH = SCOPE_URL.pathname;
const DICTIONNAIRE_URL = new URL(DICTIONNAIRE, SCOPE_URL).href;
const INDEX_URL = new URL("index.html", SCOPE_URL).href;

// Corrige le type MIME si le serveur local (ex. Windows) envoie text/plain pour .js/.css/.html
const TYPES = {
  html: [/^text\/html/i, "text/html; charset=utf-8"],
  js: [/javascript|ecmascript/i, "text/javascript; charset=utf-8"],
  css: [/^text\/css/i, "text/css; charset=utf-8"],
};

async function avecLeBonType(reponse, url) {
  const chemin = new URL(url).pathname;
  const extension = chemin.endsWith("/") ? "html" : chemin.split(".").pop();
  const attendu = TYPES[extension];
  if (!attendu || attendu[0].test(reponse.headers.get("Content-Type") || "")) return reponse;
  const entetes = new Headers(reponse.headers);
  entetes.set("Content-Type", attendu[1]);
  return new Response(await reponse.blob(), {
    status: reponse.status,
    statusText: reponse.statusText,
    headers: entetes,
  });
}

// Installation atomique : aucun skipWaiting() automatique afin de ne pas casser une session ouverte
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const prets = await Promise.all(FICHIERS.map(async (f) => {
      const url = new URL(f, SCOPE_URL).href;
      const reponse = await fetch(url, { cache: "reload" });
      if (!reponse.ok || reponse.redirected) {
        throw new Error("Fichier introuvable : " + f);
      }
      const bonne = await avecLeBonType(reponse, url);
      const corps = await bonne.blob();
      return [url, new Response(corps, {
        status: bonne.status,
        statusText: bonne.statusText,
        headers: bonne.headers,
      })];
    }));

    const cacheApp = await caches.open(CACHE_APP);
    await Promise.all(prets.map(([url, reponse]) => cacheApp.put(url, reponse)));

    // Dictionnaire isolé (2,33 Mo) : une coupure réseau ne bloque pas l'installation du cœur
    try {
      const cacheDico = await caches.open(CACHE_DICO);
      const deja = await cacheDico.match(DICTIONNAIRE_URL, { ignoreSearch: true });
      if (!deja) {
        const repDico = await fetch(DICTIONNAIRE_URL, { cache: "reload" });
        if (repDico.status === 200 && repDico.type === "basic") {
          await cacheDico.put(DICTIONNAIRE_URL, repDico);
        }
      }
    } catch {
      // Sera mis en cache lors du premier fetch réussi
    }
  })());
});

// Activation : ne supprime que les anciens caches d'omni-romancier et les noms exacts hérités
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(
      noms
        .filter((nom) =>
          nom !== CACHE_APP &&
          nom !== CACHE_DICO &&
          (nom.startsWith(CACHE_PREFIX) || CACHES_HERITES.has(nom))
        )
        .map((nom) => caches.delete(nom))
    );
    await self.clients.claim();
  })());
});

// Activation sur demande explicite de l'utilisateur (« Mettre à jour »)
self.addEventListener("message", (e) => {
  if (e.data === "activer" || (e.data && e.data.type === "SKIP_WAITING")) {
    self.skipWaiting();
    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage({ ok: true });
    }
  }
});

// Stratégie Cache-First pour les fichiers du scope, avec mise en cache paresseuse du dictionnaire
self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  e.respondWith(repondre(request, url));
});

async function repondre(request, url) {
  const cacheApp = await caches.open(CACHE_APP);
  const enCacheApp = await cacheApp.match(request, { ignoreSearch: true });
  if (enCacheApp) return enCacheApp;

  const cacheDico = await caches.open(CACHE_DICO);
  const enCacheDico = await cacheDico.match(request, { ignoreSearch: true });
  if (enCacheDico) return enCacheDico;

  // Fallback vers index.html uniquement pour la racine du scope ou index.html
  // (évite d'intercepter les documents comme LICENCE-dictionnaire.txt ou fonts/OFL.txt)
  const estRacineOuIndex =
    url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + "index.html";
  if (request.mode === "navigate" && estRacineOuIndex) {
    const indexEnCache = await cacheApp.match(INDEX_URL, { ignoreSearch: true });
    if (indexEnCache) return indexEnCache;
  }

  try {
    const reponse = await fetch(request);
    if (reponse.status === 200 && reponse.type === "basic" && url.href === DICTIONNAIRE_URL) {
      cacheDico.put(DICTIONNAIRE_URL, reponse.clone()).catch(() => {});
    }
    return reponse.ok ? avecLeBonType(reponse, url.href) : reponse;
  } catch {
    return new Response("Hors ligne : ce fichier n'est pas disponible.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
