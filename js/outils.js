// =====================================================================
// PETITS OUTILS PARTAGÉS par toutes les parties de l'application
// =====================================================================

import { masquerSauts } from "../commun/saut-de-page.js";

// Les modes d'écriture d'un roman
export const MODES_ROMAN = {
  jdr: {
    nom: "Roman JDR",
    badge: "JDR",
    description: "Tiré d'une partie de l'Omni-système (univers, PNJ, événements).",
  },
  libre: {
    nom: "Roman libre",
    badge: "Hors JDR",
    description: "Roman indépendant du JDR (genre littéraire, synopsis, arcs narratifs).",
  },
};

// Les univers de l'Omni-système (la clé sert dans le code et dans theme.css)
export const UNIVERS = {
  cyber:   { nom: "Cyberpunk" },
  fantasy: { nom: "Fantasy" },
  space:   { nom: "Space opéra" },
  horreur: { nom: "Horreur / enquête" },
  autre:   { nom: "Autre" },
};

// Les genres littéraires du mode Roman libre (la clé sert dans le code et dans theme.css)
export const GENRES = {
  contemporain: { nom: "Contemporain" },
  policier:     { nom: "Policier / Thriller" },
  imaginaire:   { nom: "Imaginaire" },
  historique:   { nom: "Historique" },
  romance:      { nom: "Romance" },
  autre:        { nom: "Autre" },
};

export function modeDuRoman(roman) {
  return roman && roman.mode === "libre" ? "libre" : "jdr";
}

export function estModeLibre(roman) {
  return modeDuRoman(roman) === "libre";
}

// Clé CSS et nom affiché du thème (univers en JDR, genre en Roman libre)
export function themeDuRoman(roman) {
  if (estModeLibre(roman)) {
    const genre = GENRES[roman?.genre] ? roman.genre : "autre";
    return { cle: genre === "autre" ? "autre" : "genre-" + genre, nom: GENRES[genre].nom, genre };
  }
  const univers = UNIVERS[roman?.univers] ? roman.univers : "autre";
  return { cle: univers, nom: UNIVERS[univers].nom, univers };
}

// Fabrique un identifiant unique (ex. « 3f2b…-… »)
export function nouvelId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Crée un élément HTML en une ligne.
// Exemple : el("p", { class: "discret" }, "Bonjour")
// Le texte est toujours inséré comme du texte (jamais comme du code) : c'est plus sûr.
export function el(balise, attributs = {}, ...enfants) {
  const e = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (nom.startsWith("on") && typeof valeur === "function") {
      e.addEventListener(nom.slice(2), valeur);           // ex. onclick
    } else if (nom === "style" && typeof valeur === "object") {
      for (const [k, v] of Object.entries(valeur)) e.style.setProperty(k, v);
    } else {
      e.setAttribute(nom, valeur === true ? "" : valeur);
    }
  }
  for (const enfant of enfants.flat(Infinity)) { // les listes imbriquées sont dépliées
    if (enfant == null || enfant === false) continue;
    e.append(enfant instanceof Node ? enfant : String(enfant));
  }
  return e;
}

// Change le texte d'un élément (un compteur, « Enregistré ✓ »…) sans rien retirer de la page.
// Pendant que l'on tape, Chrome découpe l'annulation (Ctrl+Z) dès que quelque chose est retiré
// de la page : Ctrl+Z n'annulerait plus la phrase tapée d'un seul coup. Or « textContent = … »
// retire l'ancien texte : on change donc plutôt le texte lui-même.
export function ecrireTexte(element, texte) {
  const n = element.firstChild;
  if (!n) element.append(texte);
  else if (n === element.lastChild && n.nodeType === Node.TEXT_NODE) { if (n.data !== texte) n.data = texte; }
  else element.textContent = texte;
}

// Compte les mots d'un texte (les symboles de mise en forme * et les sauts de page ne comptent pas)
export function compterMots(texte) {
  if (typeof texte !== "string" || !texte) return 0; // rien (ou pas du texte) : 0 mot
  const mots = masquerSauts(texte)
    .replace(/\*/g, "")    // retire les * de *italique* et **gras** (« * * * » = 0 mot)
    // Un mot = lettres, chiffres et accents, éventuellement reliés par une apostrophe ou un trait
    // d'union (« aujourd'hui », « peut-être » = 1 mot), ou un nombre écrit « 12,5 » ou « 10 000 »
    // (avec espace insécable).
    .match(/[\p{L}\p{N}\p{M}]+(?:(?:['’‘\u2011-]|(?<=\p{N})[.,\u00A0\u202F](?=\p{N}))[\p{L}\p{N}\p{M}]+)*/gu);
  return mots ? mots.length : 0;
}

// Écrit un nombre à la française : 12 345
export function nombre(n) {
  // 136 668 : espace insécable normale (l'espace « fine » du navigateur est presque invisible en petit)
  return n.toLocaleString("fr-FR").replace(/\u202F/g, "\u00A0");
}

// Accorde un mot au pluriel : pluriel(3, "scène") → « 3 scènes »
export function pluriel(n, mot, motPluriel = mot + "s") {
  return nombre(n) + " " + (n > 1 ? motPluriel : mot);
}

// Date lisible : « 14 oct. 2026 »
export function dateCourte(ms) {
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// Durée écoulée, en mots simples : « aujourd'hui », « hier », « il y a 5 jours »
export function ilYa(ms) {
  const jours = Math.floor((debutDuJour(Date.now()) - debutDuJour(ms)) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  return "il y a " + jours + " jours";
}
function debutDuJour(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Date et heure lisibles : « 14 oct. 2026 à 15:42 »
export function dateHeure(ms) {
  return dateCourte(ms) + " à " + new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Ce qu'est cet appareil, en mots simples (pour reconnaître d'où vient un fichier de sauvegarde)
export function nomAppareil(ua = navigator.userAgent, tactile = navigator.maxTouchPoints > 1) {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && tactile)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "téléphone Android" : "tablette Android";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Windows/.test(ua)) return "ordinateur Windows";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "ordinateur Linux";
  return "autre appareil";
}

// Date du jour pour un nom de fichier : 2026-10-14
export function dateFichier(ms = Date.now()) {
  const d = new Date(ms);
  const deux = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate());
}

// Lit une valeur de stockage sous « nouvelleCle » ; si absente, migre doucement
// depuis « ancienneCle » sans perte de données.
export function lireAvecMigration(nouvelleCle, ancienneCle, stockage = localStorage) {
  try {
    const valeur = stockage.getItem(nouvelleCle);
    if (valeur !== null) return valeur;
    const ancienne = stockage.getItem(ancienneCle);
    if (ancienne === null) return null;
    try {
      stockage.setItem(nouvelleCle, ancienne);
      stockage.removeItem(ancienneCle);
    } catch { /* stockage plein ou lecture seule : on garde l'ancienne clé pour ne rien perdre */ }
    return ancienne;
  } catch {
    return null;
  }
}

// Sur petit ou moyen écran, quand un volet (« Plan » ou « Fiches ») est ouvert,
// rend l'arrière-plan inerte (piège Tab) ; sinon, tout redevient actif.
export function majInertVolets() {
  const vue = document.getElementById("vue-roman");
  if (!vue) return;
  const plan = document.getElementById("plan");
  const panneau = document.getElementById("panneau");
  const editeur = vue.querySelector(".editeur");
  const entete = document.querySelector(".entete");
  const planVolet = !vue.hidden && vue.classList.contains("plan-ouvert") && plan && getComputedStyle(plan).position === "fixed";
  const panneauVolet = !vue.hidden && vue.classList.contains("panneau-ouvert") && panneau && getComputedStyle(panneau).position === "fixed";
  if (plan) plan.inert = !!panneauVolet;
  if (panneau) panneau.inert = !!planVolet;
  if (editeur) editeur.inert = !!(planVolet || panneauVolet);
  if (entete) entete.inert = !!(planVolet || panneauVolet);
}

// ---------- Mesurer le texte d'une zone de texte (<textarea>) ----------

// Ce qui doit être identique pour qu'un texte se coupe en lignes comme celui d'une zone de texte
export const STYLES_DU_TEXTE = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontKerning",
  "fontFeatureSettings", "fontVariationSettings", "lineHeight", "letterSpacing", "wordSpacing", "tabSize",
  "textIndent", "textTransform", "textRendering", "whiteSpace", "overflowWrap", "wordBreak", "hyphens",
  "direction", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
];

// La place du texte d'une zone de texte, sans ses bordures ni sa barre de défilement,
// par rapport à l'élément qui la contient : { gauche, haut, largeur, hauteur }.
// Au centième de pixel près : une colonne mesure par exemple 452,4 pixels,
// et une largeur arrondie à 452 couperait parfois les lignes une lettre plus loin.
export function placeDuTexte(zone) {
  if (!zone.offsetParent) return null;
  const cs = getComputedStyle(zone);
  const boite = zone.getBoundingClientRect();
  const parent = zone.offsetParent, cadre = parent.getBoundingClientRect();
  const [gauche, droite, haut, bas] = ["Left", "Right", "Top", "Bottom"].map((c) => parseFloat(cs[`border${c}Width`]) || 0);
  // L'épaisseur des barres de défilement (en pixels entiers : un écart d'un pixel n'est qu'un arrondi)
  const barre = (n) => (n >= 2 ? n : 0);
  return {
    gauche: boite.left - cadre.left - parent.clientLeft + gauche,
    haut: boite.top - cadre.top - parent.clientTop + haut,
    largeur: boite.width - gauche - droite - barre(zone.offsetWidth - Math.round(gauche + droite) - zone.clientWidth),
    hauteur: boite.height - haut - bas - barre(zone.offsetHeight - Math.round(haut + bas) - zone.clientHeight),
  };
}

// À quelle hauteur (en pixels, depuis le haut du texte) se trouve la ligne d'une position du texte.
// On recopie le texte jusqu'à cette position dans un double invisible, et l'on mesure.
export function hauteurDansLeTexte(zone, position) {
  const place = placeDuTexte(zone);
  if (!place) return 0;
  const cs = getComputedStyle(zone);
  const double = document.createElement("div");
  for (const p of STYLES_DU_TEXTE) double.style[p] = cs[p];
  Object.assign(double.style, {
    position: "absolute", visibility: "hidden", top: "0", left: "-100000px", width: place.largeur + "px",
  });
  double.textContent = zone.value.slice(0, position);
  const repere = double.appendChild(document.createElement("span"));
  repere.textContent = "\u200b";
  document.body.append(double);
  const hauteur = repere.offsetTop;
  double.remove();
  return hauteur;
}
