# Le correcteur orthographique (module commun)

Ce dossier est **identique** dans Omni-Texte et dans Omni-Romancier. On le
modifie **seulement dans omni-texte**, puis on le recopie dans
omni-romancier :

```
node outils/copier-commun.mjs              (depuis le dossier omni-texte)
node outils/copier-commun.mjs --verifier   (vérifie que les deux sont identiques)
```

Les tests d'Omni-Texte vérifient aussi que les deux exemplaires sont identiques,
quand les deux dépôts sont côte à côte.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `correcteur.js` | Ce que l'application utilise : vérifier un texte, proposer des corrections, dictionnaire personnel, mots ignorés, réglage |
| `moteur.js` | Les calculs : lecture du dictionnaire, recherche des mots inconnus, suggestions |
| `travailleur.js` | Fait tourner le moteur en arrière-plan (Web Worker), pour ne jamais ralentir l'écriture |
| `bulle.js` | La bulle de suggestions qui apparaît quand on touche un mot souligné |
| `liste.js` | L'écran du dictionnaire personnel (ajouter, voir, retirer des mots) |
| `correcteur.css` | L'apparence de la bulle, de la liste et du soulignement (couleurs fournies par chaque application) |
| `mots-fr-7.5.txt` | Le dictionnaire : environ 450 000 formes de mots français, compressées |
| `LICENCE-dictionnaire.txt` | La licence du dictionnaire (MPL 2.0) et sa provenance |

Le soulignement lui-même est fait par chaque application, car leurs zones
d'écriture sont différentes :

- Omni-Texte : `js/orthographe.js` (surlignage CSS, sans toucher au document) ;
- Omni-Romancier : `js/orthographe.js` et `js/surlignage.js` (calque derrière la zone de texte).

## Règles du correcteur

- Les mots absents du dictionnaire sont soulignés, une demi-seconde après la dernière frappe.
- Apostrophes : « l'ami », « qu'il », « jusqu'à » sont reconnus (seul le mot après l'apostrophe est vérifié).
- Traits d'union : « peut-être », « est-ce », « a-t-il » ; chaque morceau inconnu est souligné séparément.
- Majuscules : « Maison » (début de phrase) et « MAISON » sont acceptés si « maison » existe ; « paris » ne vaut pas « Paris ».
- Ignorés : nombres, chiffres romains (XIXe), adresses web, adresses e-mail, mots d'une seule lettre.
- Le mot en cours de frappe n'est souligné que lorsque le curseur le quitte.

## Mettre à jour le dictionnaire

Le fichier `mots-fr-7.5.txt` est fabriqué à partir du dictionnaire Hunspell
de Grammalecte par `outils/dictionnaire/construire.mjs` (dans omni-texte).
Pour une nouvelle version du dictionnaire :

1. remplacer les fichiers de `outils/dictionnaire/source/` ;
2. changer `VERSION` dans `construire.mjs`, puis lancer `npm install` et
   `node construire.mjs` dans `outils/dictionnaire/` ;
3. changer `DICTIONNAIRE` dans `correcteur.js`, et le nom du fichier dans les
   deux `sw.js` (listes `FICHIERS` et `DURABLES`) ;
4. supprimer l'ancien fichier, recopier le correcteur dans omni-romancier, et
   changer la version des deux applications.

## Vie privée

Tout se passe sur l'appareil. Aucun texte n'est envoyé sur internet. Le
dictionnaire personnel est gardé dans le navigateur (localStorage), séparément
pour chaque application.
