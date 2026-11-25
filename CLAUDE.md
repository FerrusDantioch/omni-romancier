# Omni-Romancier — Consignes techniques (CLAUDE.md)

PWA d'écriture de romans tirés des parties de l'écosystème **Omni-Système**, développée en **HTML / CSS / JavaScript (modules ES natifs) sans aucune étape de compilation (build)** ni dépendance npm d'exécution.

---

## 1. Architecture et règles strictes

- **Zéro build / zéro bundler** : les fichiers sont servis tels quels sur GitHub Pages. Ne jamais commiter `node_modules/`, `package.json` ni `package-lock.json` (Playwright s'installe uniquement avec `--no-save` en CI ou en local temporaire).
- **Point d'entrée unique** : `index.html` charge :
  - `css/theme.css`, `css/app.css`, `correcteur/correcteur.css` et `css/impression.css` ;
  - `js/config.js` (script classique IIFE exposant `CONFIG_APP` pour la page et le service worker) ;
  - `js/app.js` en `<script type="module">`.
- **Modules communs avec Omni-Texte** :
  - `correcteur/` et `commun/` sont partagés à l'identique avec le dépôt `omni-texte` (voir `correcteur/LISEZ-MOI.md` et `commun/LISEZ-MOI.md`). Ne pas les faire diverger unilatéralement ici.
- **CSP stricte dans `index.html`** :
  - `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
  - Aucun `'unsafe-eval'`, aucun `'unsafe-inline'` dans `script-src` ni `style-src`.
  - Zéro `<script>` inline sans `src`, zéro `<style>` inline, zéro attribut `style=` et zéro attribut `on*=`.
- **Zéro requête réseau externe** :
  - Aucune police distante (`fonts/*.woff2` locales), aucun CDN, aucune télémétrie.
  - Les seules URLs externes autorisées dans le code sont les namespaces XML (W3C, IDPF/EPUB, Dublin Core, DAISY, OpenXML pour l'export ePub/Word) et, dans `js/config.js` uniquement, `licenceUrl` et `portfolio` (et l'URL d'information Grammalecte si présente).
  - La page doit rester strictement protégée contre toute injection XSS lors de l'affichage de contenus utilisateur (construction DOM via `el()` / `textContent`, jamais `innerHTML` non maîtrisé).

---

## 2. Version, Service Worker et invariants de stockage

- **Source unique de version** : `js/config.js` (`CONFIG_APP.version`, actuellement `'1.13.0'`).
  - `sw.js` importe `js/config.js` via `importScripts('js/config.js')` pour construire le cache applicatif versionné (ex. `'omni-romancier-app-v' + self.CONFIG_APP.version`).
  - **Cache dictionnaire séparé** : le dictionnaire français (`correcteur/mots-fr-7.5.txt`, ~2 Mo) est conservé dans un cache dédié (ex. `'omni-romancier-dico-v1'`) afin d'éviter de le retélécharger à chaque mise à jour de l'application.
  - Tout nouveau fichier applicatif ou ressource runtime (`.css`, `.js`, `.woff2`, `assets/*.png`, `correcteur/*`, `commun/*`, licences `.txt`) doit être ajouté dans `sw.js` (`FICHIERS` / `DICTIONNAIRE`), puis incrémenter `version` dans `js/config.js`.
  - **Mise à jour manuelle** : le service worker ne remplace jamais l'application en cours par surprise ; il prépare la nouvelle version et affiche le bandeau `#bandeau-mise-a-jour` (« Mettre à jour »).
- **Invariants à ne jamais modifier après publication** :
  - `manifest.webmanifest` : `"id": "/omni-romancier/"`, `"start_url": "./"`, `"scope": "./"`. Ne jamais repasser `"id"` à `"./"`, et ne pas réintroduire `manifest.json`.
  - Base **IndexedDB** : nom `"atelier-romans"` (hérité de l'ancien nom de l'application ; ne jamais renommer pour préserver les romans existants), magasins `romans`, `chapitres`, `scenes`, `fiches`, `reglages`, et `FORMAT_EXPORT = "atelier-romans"`.
  - Préfixe des caches Service Worker : `"omni-romancier-"` uniquement. Dans `activate`, le SW ne doit **jamais** supprimer les caches d'autres applications sur `ferrusdantioch.github.io` (notamment `atelier-pwa-v1`, `omni-agenda-*`, `omni-liseuse-*`, `omni-time-*`).
  - **Migration `localStorage` vers `omni-romancier-*`** : les anciennes clés `atelier-*` (`atelier-secours:*`, `atelier-cote-a-cote`, `atelier-surlignage`, `atelier-recherche`, `atelier-correcteur`, `atelier-dictionnaire-personnel`) migrent proprement vers le préfixe `omni-romancier-*` sans perte de réglages ni de copies de secours.

---

## 3. Hygiène Git et règles du socle Omni-Système

- **Fins de ligne LF** : `.gitattributes` impose `* text=auto eol=lf`. Critique sous Windows pour que `correcteur/mots-fr-7.5.txt` (lu par `correcteur/moteur.js`) et `LICENSE` restent en LF pur.
- **Tutoiement obligatoire** dans toute l'interface utilisateur et la documentation (`README.md`, `LISEZ-MOI.md`).
- **Identité et anonymat** : seul le pseudonyme **Ferrus Dantioch** est utilisé (conçu avec l'aide de l'intelligence artificielle). Ne jamais inclure de vrai nom.
- **Licence** : `CC BY-NC-ND 4.0` (`Creative Commons Attribution - Pas d'Utilisation Commerciale - Pas de Modification 4.0 International`), avec son explication en français. Ne pas modifier le fichier `LICENSE`. Les ressources tierces sont documentées dans `fonts/OFL.txt` (SIL OFL 1.1) et `correcteur/LICENCE-dictionnaire.txt` (MPL 2.0).
- **Contact officiel** : `omni-systeme.choking513@passmail.net` (présent dans `index.html`, `js/config.js`, `README.md` et `LISEZ-MOI.md`).
- **Installation Android** : documenter la limite de Chrome Android (une seule PWA par origine `ferrusdantioch.github.io`) et recommander **Brave** dans `README.md`.

---

## 4. Commandes de vérification

- Syntaxe JavaScript / ESM :
  ```sh
  node --check <fichier>
  ```
- Contrôles statiques (sans dépendance) :
  ```sh
  node tests/verifier-statique.mjs
  ```
- Suite E2E Playwright (avec serveur local fidèle à `/omni-romancier/`) :
  ```sh
  node tests/tester.js
  ```
