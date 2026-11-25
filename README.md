# Omni-Romancier

**Omni-Romancier** est une application web installable (PWA) d'écriture de romans tirés des parties de l'**Omni-système**. Elle fonctionne **100 % localement**, **hors ligne**, **sans compte** et **sans traceur** : tes romans, fiches et brouillons restent sur ton appareil dans le navigateur (**IndexedDB**).

Application de l'écosystème **Omni-Système** :
- **Ouvrir l'application :** <https://ferrusdantioch.github.io/omni-romancier/>
- **Découvrir les autres applications :** <https://ferrusdantioch.github.io/omni-systeme/#applications>
- **Manuel d'utilisation détaillé :** [LISEZ-MOI.md](LISEZ-MOI.md)

---

## 1. Ce que fait Omni-Romancier

- **Bibliothèque par univers** : range tes romans par univers (*Cyberpunk*, *Fantasy*, *Space opéra*, *Horreur / enquête*, *Autre*), chacun habillant l'interface de sa couleur.
- **Écriture structurée** : organise chaque roman en chapitres et scènes, avec deux versions par scène (*Notes* pour les fragments et puces, *Rédigé* pour le texte du roman) ou **les deux côte à côte** sur écran large.
  - Mise en forme légère (`*italique*`, `**gras**`, séparateur `* * *`, saut de page `Ctrl+Entrée`).
  - Compteurs de mots en temps réel (scène, chapitre, roman), objectif de session et mode concentration (`Ctrl+Maj+F`).
- **Fiches à portée de main** : personnages principaux (jusqu'à deux épinglés côte à côte), PNJ, lieux et événements.
  - **Recherche rapide (`Ctrl+K`)** : ouvre n'importe quelle fiche à côté du texte sans déplacer ton curseur.
  - **Repérage automatique** : bloc *Dans cette scène*, noms soulignés en couleur dans le texte et liste *Nommé dans ces scènes* sur chaque fiche.
  - **Frise des événements** : visualise toute la partie sur une ligne du temps et repère *Qui apparaît où*.
- **Correcteur orthographique français intégré** : vérifie l'orthographe localement et hors ligne (dictionnaire français Grammalecte/Dicollecte embarqué), avec suggestions, dictionnaire personnel et acceptation automatique des noms de tes fiches.
- **Rechercher et remplacer (`Ctrl+F` / `Ctrl+H`)** : cherche et remplace dans tout le roman (texte rédigé et notes), avec aperçu et annulation sécurisée.
- **Export prêt à lire ou relire** : exporte une scène, un chapitre ou tout le roman en **PDF** (mise en page de livre A5 ou A4), en **ePub** (liseuses) ou en **Word (`.docx`)**, avec en option les notes des scènes et les fiches en annexe.
- **Sauvegarde et fusion multi-appareils** : sauvegarde automatique continue, copie de secours instantanée en cas de fermeture brutale, export/import complet en `.json` et **fusion intelligente** entre téléphone et ordinateur sans rien écraser.

---

## 2. Structure du projet

```text
omni-romancier/
├── .gitattributes          Forçage des fins de ligne LF pour les fichiers texte
├── .gitignore              Exclusions locales (node_modules, fichiers temporaires)
├── .nojekyll               Désactive Jekyll sur GitHub Pages
├── .github/workflows/
│   └── ci.yml              Intégration continue (syntaxe, contrôles statiques, Playwright)
├── LICENSE                 Texte officiel de la licence CC BY-NC-ND 4.0 (EN + FR)
├── README.md               Cette présentation technique et générale
├── LISEZ-MOI.md            Guide complet pas-à-pas d'utilisation
├── CLAUDE.md               Consignes techniques et invariants pour le développement
├── index.html              Coque HTML de l'application (CSP stricte, zéro script/style inline)
├── manifest.webmanifest    Manifeste PWA (id: "/omni-romancier/")
├── sw.js                   Service worker hors ligne (cache app versionné + cache dictionnaire)
├── serveur.py              Petit serveur Python local avec les bons types MIME
├── css/
│   ├── theme.css           Polices locales (@font-face) et variables des thèmes/univers
│   ├── app.css             Mise en page générale et éditeur
│   └── impression.css      Mise en page de livre pour l'export PDF
├── js/
│   ├── config.js           Configuration unique (nom, version, auteur, contact, licence)
│   ├── app.js              Point d'entrée ES module et orchestration
│   ├── db.js               Stockage IndexedDB ("atelier-romans") et export/import JSON
│   ├── fusion.js           Fusion multi-appareils
│   ├── editeur.js          Éditeur Notes / Rédigé / Côte à côte, compteurs et secours
│   ├── panneau.js          Consultation et édition des fiches
│   ├── frise.js            Frise chronologique des événements
│   ├── recherche.js        Recherche rapide de fiches (Ctrl+K)
│   ├── remplacer.js        Rechercher et remplacer dans tout le roman (Ctrl+F / Ctrl+H)
│   ├── reperage.js         Détection des personnages et lieux dans les scènes
│   ├── surlignage.js       Calque des noms en couleur et fautes d'orthographe
│   ├── orthographe.js      Pont avec le correcteur orthographique
│   ├── export-pdf.js       Fenêtre d'export et génération PDF
│   ├── export-fichiers.js  Génération ePub et Word (.docx)
│   ├── zip.js              Construction d'archives ZIP locales
│   ├── annulation.js       Gestion sécurisée de Ctrl+Z
│   ├── sauvegarde.js       Boutons de sauvegarde/import et rappel doux
│   ├── hors-ligne.js       Service worker, mise à jour manuelle et installation PWA
│   ├── onglets.js          Verrou d'onglet unique
│   ├── plan.js             Gestion des chapitres et scènes
│   ├── bibliotheque.js     Liste et gestion des romans
│   ├── etat.js             État courant du roman ouvert
│   ├── dialogues.js        Fenêtres modales et notifications
│   └── outils.js           Utilitaires partagés
├── correcteur/             Moteur et dictionnaire français communs avec Omni-Texte
├── commun/                 Gestion du saut de page commune avec Omni-Texte
├── fonts/                  Polices locales (Oxanium, Literata, JetBrains Mono) + OFL.txt
├── assets/                 Logos et icônes PWA
└── tests/
    ├── verifier-statique.mjs  Contrôles statiques sans dépendance externe
    ├── tester.js              Suite E2E Playwright (écriture, correcteur, remplacer, hors ligne)
    └── outils.js              Serveur local de test et vérifications communes
```

---

## 3. Lancement local et tests

> **Pourquoi passer par un serveur local ?**
> Les modules ES (`type="module"`), le Web Worker du correcteur et le service worker ne fonctionnent pas si tu ouvres `index.html` directement en `file://`. Il faut servir le dossier via `http://localhost`.

### Lancer l'application en local

Depuis le dossier `omni-romancier` :

- **Avec le script fourni (recommandé sous Windows)** :
  - Windows : `py serveur.py`
  - macOS / Linux : `python3 serveur.py`
  - Ouvre ensuite <http://localhost:8000>.
- **Avec un serveur HTTP statique générique** :
  - Python : `py -m http.server 8000` (ou `python3 -m http.server 8000`)
  - Node.js : `npx http-server -p 8000 -c-1`

*(Une fois l'application installée depuis ton navigateur, tu n'as plus besoin de relancer le serveur pour écrire.)*

### Exécuter les tests automatisés

1. **Contrôles statiques** (Node.js 22+, aucune dépendance requise) :
   ```sh
   node tests/verifier-statique.mjs
   ```
   Vérifie `.gitattributes` (LF), `.nojekyll`, les licences (`LICENSE`, `fonts/OFL.txt`, `correcteur/LICENCE-dictionnaire.txt`), la CSP stricte dans `index.html`, le manifeste `manifest.webmanifest`, la cohérence `js/config.js` ↔ `sw.js` ↔ disque (vérification réciproque et isolation des caches), les fins de ligne du dictionnaire, l'absence d'URL externe non autorisée et les mentions obligatoires.

2. **Tests navigateur E2E (Playwright)** :
   ```sh
   npm install --no-save playwright
   npx playwright install chromium
   node tests/tester.js
   ```
   Teste l'affichage mobile sans débordement, l'installation du service worker et la réouverture hors ligne, la création et persistance d'un roman/chapitre/scène, les compteurs de mots, l'export JSON et ePub (avec notes et fiches), l'épinglage de deux personnages principaux, le correcteur orthographique français, le rechercher/remplacer avec espace final, l'accès hors ligne aux fichiers de licences et le bandeau de mise à jour manuelle du service worker.

---

## 4. Installation sur mobile (Android / iPhone)

### Note importante pour Android : Chrome Android vs Brave

Toutes les applications d'Omni-Système sont hébergées sur la même origine (`ferrusdantioch.github.io`).
- **Sur Chrome Android** : par limitation du navigateur, Chrome n'accepte d'installer en PWA autonome **qu'une seule application** provenant d'un même domaine, même si chaque application possède un `id` (`/omni-romancier/`) et un `scope` (`./`) distincts. Si tu as déjà installé une autre application Omni-Système via Chrome, Chrome peut refuser l'installation ou ouvrir l'autre application.
- **Sur Brave Android (recommandé si tu utilises plusieurs applications Omni-Système)** : Brave installe chaque PWA indépendamment sans conflit d'icône ni de lancement.
- **Alternative dans Chrome Android** : utilise le menu **⋮** → **Ajouter à l'écran d'accueil** → **Créer un raccourci** (l'application s'ouvrira dans un onglet Chrome tout en conservant son fonctionnement hors ligne).

### Sur iPhone / iPad (Safari)

Ouvre <https://ferrusdantioch.github.io/omni-romancier/> dans Safari, touche le bouton **Partager**, puis **Sur l'écran d'accueil**.

---

## 5. Confidentialité

- **Zéro serveur, zéro compte, zéro télémétrie.**
- Une politique **Content Security Policy (CSP)** stricte (`default-src 'none'`, `script-src 'self'`, `style-src 'self'`) empêche le chargement de ressources externes et l'exécution de scripts inline.
- Le correcteur orthographique et l'export PDF/ePub/Word tournent intégralement sur ton appareil.

---

## 6. Contact et retours

Une question, un bug ou une suggestion ? Tu peux écrire à :
**`omni-systeme.choking513@passmail.net`**

---

## 7. Auteur et licences

- **Auteur** : **Ferrus Dantioch** *(application conçue et développée avec l'aide de l'intelligence artificielle)*.
- **Licence du code d'Omni-Romancier** : **Creative Commons Attribution - Pas d'Utilisation Commerciale - Pas de Modification 4.0 International (`CC BY-NC-ND 4.0`)** — ([résumé officiel en français](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.fr)).
  - **Attribution** : tu dois créditer **Ferrus Dantioch** et indiquer un lien vers la licence.
  - **Pas d'Utilisation Commerciale** : toute exploitation commerciale de l'application est interdite sans autorisation.
  - **Pas de Modification** : tu peux partager l'application à l'identique, mais tu ne peux pas distribuer de version modifiée ou d'œuvre dérivée sans autorisation préalable.
  - Le texte juridique complet (version officielle anglaise et traduction française officielle) figure dans le fichier [LICENSE](LICENSE).
- **Ressources tierces** :
  - **Dictionnaire français (`correcteur/mots-fr-7.5.txt`)** : tiré des « Dictionnaires orthographiques français » 7.5 (variante « Classique ») d'Olivier R. et des contributeurs de [Grammalecte](https://grammalecte.net/) (Dicollecte), sous **Mozilla Public License 2.0 (MPL 2.0)** — voir [correcteur/LICENCE-dictionnaire.txt](correcteur/LICENCE-dictionnaire.txt).
  - **Polices (`fonts/`)** : **Oxanium**, **Literata** et **JetBrains Mono**, sous **SIL Open Font License 1.1** — voir [fonts/OFL.txt](fonts/OFL.txt).
