// Le saut de page sous forme de texte simple (module commun).
//
// Ce fichier est IDENTIQUE dans Omni-Texte et dans Omni-Romancier. On le
// modifie seulement dans omni-texte, puis on le recopie avec
// « node outils/copier-commun.mjs » (voir commun/LISEZ-MOI.md).
//
// Dans un texte simple (zone de texte d'Omni-Romancier, fichier .txt), un saut
// de page est une ligne qui ne contient que le repère :
//
//     ──── Saut de page ────
//
// Les traits « ─ » (caractère U+2500, « trait de dessin de boîte ») ne se
// trouvent sur aucun clavier : le repère ne peut donc pas apparaître en
// tapant du texte normal, seulement avec le bouton « Saut de page » (ou en
// collant un texte qui le contient déjà).
//
// Le reste du fichier sert à PROTÉGER ce repère dans une zone de texte : un
// retour arrière l'efface en entier d'un coup, et rien ne peut s'écrire au
// milieu (le texte tapé va sur la ligne d'à côté). Toutes les fonctions
// travaillent sur du texte et des positions (nombres de caractères) : elles ne
// touchent à rien elles-mêmes, elles disent seulement quoi remplacer.

/** Le repère tel qu'il est inséré. */
export const SAUT_DE_PAGE = '──── Saut de page ────';

// Une ligne est un saut de page si elle contient le repère et rien d'autre
// (des espaces autour sont tolérés, et le nombre de traits peut varier : un
// fichier .txt retouché à la main reste reconnu).
const MOTIF = /^[ \t]*─{2,}[ \t]*Saut de page[ \t]*─{2,}[ \t]*$/;

// Le même repère, au milieu d'autres caractères (voir reparerSauts).
const MOTIF_DANS_LA_LIGNE = /─{2,}[ \t]*Saut de page[ \t]*─{2,}/;

/** Vrai si cette ligne (sans son retour à la ligne) est un saut de page. */
export function estSautDePage(ligne) {
  return MOTIF.test(ligne);
}

/**
 * Le même texte, où chaque ligne de saut de page est remplacée par un
 * caractère neutre (U+FFFF, qui n'est ni une lettre, ni une espace, et qu'on
 * ne tape jamais) répété sur toute sa longueur. Les positions ne changent
 * pas : on s'en sert pour chercher dans le texte (mots, noms, recherche) sans
 * jamais tomber sur le repère.
 */
export function masquerSauts(texte) {
  if (!texte || !texte.includes('─')) return texte;
  return texte
    .split('\n')
    .map((ligne) => (estSautDePage(ligne) ? '\uFFFF'.repeat(ligne.length) : ligne))
    .join('\n');
}

/** Bornes de la ligne qui contient la position : { debut, fin, texte }. */
export function ligneA(texte, position) {
  const debut = position <= 0 ? 0 : texte.lastIndexOf('\n', position - 1) + 1;
  let fin = texte.indexOf('\n', position);
  if (fin < 0) fin = texte.length;
  return { debut, fin, texte: texte.slice(debut, fin) };
}

/**
 * Ce qu'il faut retirer pour effacer la ligne d'un saut de page : la ligne
 * et le retour à la ligne qui la suit (ou, pour la dernière ligne, celui
 * qui la précède). Les lignes voisines restent ainsi chacune sur sa ligne.
 */
function effacementDeLaLigne(texte, ligne) {
  if (ligne.fin < texte.length) return { debut: ligne.debut, fin: ligne.fin + 1, remplacement: '', curseur: ligne.debut };
  const debut = Math.max(0, ligne.debut - 1);
  return { debut, fin: ligne.fin, remplacement: '', curseur: debut };
}

/**
 * Une modification va avoir lieu dans une zone de texte. Si elle abîmerait
 * un saut de page, renvoie la modification à faire à sa place :
 * { debut, fin, remplacement, curseur } (remplacer le texte entre debut et
 * fin par « remplacement », puis placer le curseur). Sinon, renvoie null :
 * le navigateur peut faire la modification normalement.
 *
 * @param {string} texte  le texte actuel
 * @param {number} debut  début de la sélection
 * @param {number} fin  fin de la sélection (= debut si rien n'est sélectionné)
 * @param {'arriere'|'avant'|'inserer'} action  retour arrière, Suppr, ou texte tapé
 * @param {string} [donnee]  le texte tapé (pour « inserer » ; « \n » pour Entrée)
 */
export function corrigerSaisie(texte, debut, fin, action, donnee = '') {
  if (!texte.includes('─')) return null; // aucun repère : rien à protéger (cas courant, très rapide)

  // Une sélection qui coupe un repère est agrandie pour le prendre en entier.
  if (debut !== fin) {
    const premiere = ligneA(texte, debut);
    const derniere = ligneA(texte, fin);
    let a = debut;
    let b = fin;
    if (estSautDePage(premiere.texte) && debut > premiere.debut) a = premiere.debut;
    if (estSautDePage(derniere.texte) && fin < derniere.fin && fin > derniere.debut) b = derniere.fin;
    if (a === debut && b === fin) return null;
    const remplacement = action === 'inserer' ? donnee : '';
    return { debut: a, fin: b, remplacement, curseur: a + remplacement.length };
  }

  const position = debut;
  const ligne = ligneA(texte, position);
  const dansUnRepere = estSautDePage(ligne.texte);

  if (action === 'arriere') {
    if (position === 0) return null;
    // Juste après un repère (début de la ligne suivante) : on efface le repère.
    if (texte[position - 1] === '\n') {
      const precedente = ligneA(texte, position - 1);
      if (estSautDePage(precedente.texte)) return effacementDeLaLigne(texte, precedente);
    }
    return dansUnRepere ? effacementDeLaLigne(texte, ligne) : null;
  }

  if (action === 'avant') {
    if (position >= texte.length) return null;
    // Juste avant un repère (fin de la ligne précédente) : on efface le repère.
    if (texte[position] === '\n') {
      const suivante = ligneA(texte, position + 1);
      // Le curseur ne bouge pas : il reste à la fin de sa ligne.
      if (estSautDePage(suivante.texte)) return { ...effacementDeLaLigne(texte, suivante), curseur: position };
    }
    return dansUnRepere ? effacementDeLaLigne(texte, ligne) : null;
  }

  // Texte tapé (ou Entrée) sur la ligne d'un repère.
  if (!dansUnRepere) return null;
  // Entrée tout au début ou tout à la fin du repère : il reste intact.
  if (donnee === '\n' && (position === ligne.debut || position === ligne.fin)) return null;
  if (position === ligne.debut) {
    // Au tout début : le texte va sur une nouvelle ligne, avant le repère.
    return { debut: position, fin: position, remplacement: `${donnee}\n`, curseur: position + donnee.length };
  }
  // Ailleurs : le texte va sur une nouvelle ligne, après le repère.
  const remplacement = donnee === '\n' ? '\n' : `\n${donnee}`;
  return { debut: ligne.fin, fin: ligne.fin, remplacement, curseur: ligne.fin + remplacement.length };
}

/**
 * Solution de secours : certains claviers de téléphone écrivent ou effacent
 * sans laisser l'application intervenir avant (« composition » d'un mot).
 * Après coup, on remet donc d'aplomb les repères abîmés :
 * - un repère collé à du texte sur la même ligne est remis seul sur sa ligne ;
 * - un repère dont il manque un seul caractère (un retour arrière qui a
 *   échappé à la protection) est effacé en entier.
 * Renvoie le texte corrigé, ou null s'il n'y avait rien à corriger.
 */
export function reparerSauts(texte) {
  if (!texte.includes('─')) return null;
  let change = false;
  const lignes = texte.split('\n').flatMap((ligne) => {
    if (!ligne.includes('─') || estSautDePage(ligne)) return [ligne];
    const trouve = ligne.match(MOTIF_DANS_LA_LIGNE);
    if (trouve) {
      change = true;
      const avant = ligne.slice(0, trouve.index);
      const apres = ligne.slice(trouve.index + trouve[0].length);
      return [avant, SAUT_DE_PAGE, apres].filter((morceau) => morceau !== '');
    }
    if (estRepereAmpute(ligne)) {
      change = true;
      return [];
    }
    return [ligne];
  });
  return change ? lignes.join('\n') : null;
}

function estRepereAmpute(ligne) {
  if (ligne.length !== SAUT_DE_PAGE.length - 1) return false;
  for (let i = 0; i < SAUT_DE_PAGE.length; i++) {
    if (SAUT_DE_PAGE.slice(0, i) + SAUT_DE_PAGE.slice(i + 1) === ligne) return true;
  }
  return false;
}

/**
 * La plus petite modification qui transforme « ancien » en « nouveau » :
 * { debut, fin, remplacement } (à appliquer sur l'ancien texte). Sert à ne
 * remplacer que le passage qui change, pour garder l'annulation (Ctrl+Z)
 * et la position du curseur.
 */
export function difference(ancien, nouveau) {
  let debut = 0;
  const max = Math.min(ancien.length, nouveau.length);
  while (debut < max && ancien[debut] === nouveau[debut]) debut++;
  let finAncien = ancien.length;
  let finNouveau = nouveau.length;
  while (finAncien > debut && finNouveau > debut && ancien[finAncien - 1] === nouveau[finNouveau - 1]) {
    finAncien--;
    finNouveau--;
  }
  return { debut, fin: finAncien, remplacement: nouveau.slice(debut, finNouveau) };
}
