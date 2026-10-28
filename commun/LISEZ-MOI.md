# Code commun à Omni-Texte et Omni-Romancier

Ce dossier est **identique** dans Omni-Texte et dans Omni-Romancier, comme le
dossier `correcteur/`. On le modifie **seulement dans omni-texte**, puis on le
recopie dans omni-romancier :

```
node outils/copier-commun.mjs              (depuis le dossier omni-texte)
node outils/copier-commun.mjs --verifier   (vérifie que les deux copies sont identiques)
```

Le même script recopie aussi le correcteur. Les tests d'Omni-Texte vérifient
que les deux exemplaires sont identiques, quand les deux dépôts sont côte à côte.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `saut-de-page.js` | Le saut de page sous forme de texte simple : le repère `──── Saut de page ────`, sa reconnaissance, et sa protection dans une zone de texte (effacé d'un coup, jamais coupé) |

## Le saut de page : un seul repère pour les deux applications

Dans un texte simple, un saut de page est une ligne qui ne contient que :

```
──── Saut de page ────
```

Les traits `─` (caractère U+2500) ne se trouvent sur aucun clavier : le repère
ne peut pas apparaître par accident en tapant. Il est produit par le bouton
« Saut de page » (ou Ctrl+Entrée dans Omni-Texte).

- **Omni-Romancier** (zone de texte simple) : le repère est écrit tel quel dans
  le texte de la scène, et donc enregistré avec lui.
- **Omni-Texte** (traitement de texte) : le saut de page est un vrai élément de
  la page (`<hr>`), affiché comme une fine ligne « Saut de page ». Le repère
  texte ne sert que dans l'export en texte brut (.txt) et quand on ouvre un
  fichier .txt ou qu'on colle du texte : la ligne redevient un vrai saut de page.

Ainsi, un texte passe d'une application à l'autre (par copier-coller ou par un
fichier .txt) sans perdre ses sauts de page.

Dans les deux applications, à l'impression (et donc dans le PDF), le repère
n'apparaît pas : ce qui le suit commence sur une nouvelle page.
