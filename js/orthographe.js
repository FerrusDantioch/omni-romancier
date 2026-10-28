// =====================================================================
// CORRECTEUR ORTHOGRAPHIQUE
// Le moteur, la bulle de suggestions et l'écran du dictionnaire personnel sont dans
// le dossier correcteur/ (commun avec Omni-Texte : ne pas le modifier ici, voir correcteur/LISEZ-MOI.md).
// Ce fichier relie le correcteur à Omni-Romancier :
//   - les fautes sont soulignées sur le calque des noms en couleur (voir surlignage.js) ;
//   - les noms des fiches (titres et « Autres noms ») ne sont jamais signalés ;
//   - le réglage et le dictionnaire personnel sont gardés dans ce navigateur, propres à Omni-Romancier.
//
// Comment ça marche : le texte est vérifié ligne par ligne (une ligne = un paragraphe), une
// demi-seconde après la dernière frappe, en arrière-plan. Le résultat de chaque ligne est gardé
// en mémoire : pendant l'écriture, seules les lignes nouvelles ou modifiées sont revérifiées.
// =====================================================================

import { estSautDePage } from "../commun/saut-de-page.js";
import { creerCorrecteur } from "../correcteur/correcteur.js";
import { ouvrirBulle, fermerBulle, replacerBulle } from "../correcteur/bulle.js";
import { afficherDictionnaire } from "../correcteur/liste.js";
import { el } from "./outils.js";
import { etat, ecouter } from "./etat.js";

const DELAI = 500;          // ms sans frappe avant de vérifier
const MEMOIRE_MAX = 20000;  // lignes gardées en mémoire (au-delà, on recommence à zéro)
const LETTRE = /\p{L}/u;

// Le réglage et le dictionnaire personnel, dans le navigateur (préfixe des réglages d'Omni-Romancier)
const stockage = {
  lire(nom, defaut) {
    try { const v = localStorage.getItem("atelier-" + nom); return v === null ? defaut : JSON.parse(v); } catch { return defaut; }
  },
  ecrire(nom, valeur) {
    try { localStorage.setItem("atelier-" + nom, JSON.stringify(valeur)); } catch { /* stockage plein ou interdit : tant pis */ }
  },
};

export const correcteur = creerCorrecteur({ stockage });

const connues = new Map();  // texte d'une ligne → ses fautes [{ debut, fin, mot }] (positions dans la ligne)
const aVerifier = new Set(); // lignes à vérifier à la prochaine pause
let minuterie = null;
let generation = 0;          // augmente quand tout est à refaire (mot ajouté…) : un résultat en retard est ignoré
let redessiner = () => {};

const $ = (id) => document.getElementById(id);

/**
 * @param {(tout: boolean) => void} fonction  redessine les fautes du calque
 *   (tout = true : le réglage a changé, le calque entier est à refaire)
 */
export function initialiserOrthographe(fonction) {
  redessiner = fonction;
  correcteur.ecouter((raison) => {
    if (raison === "erreur") return;
    connues.clear();
    generation++;
    if (raison === "actif") fermerBulle();
    majCorrecteurNatif();
    redessiner(raison === "actif");
  });
  // Les noms des fiches sont acceptés (ils changent quand une fiche est modifiée, ou à l'ouverture d'un roman)
  const majNoms = () => correcteur.definirNoms(nomsDesFiches());
  ecouter("fiches-changees", majNoms);
  ecouter("scene-affichee", majNoms);
  majCorrecteurNatif();

  // Le réglage et le dictionnaire personnel (lien « Orthographe et dictionnaire », sous le titre du roman)
  $("bouton-orthographe").addEventListener("click", ouvrirReglages);
}

// Les mots de tous les noms de fiches : titres et « Autres noms »
function nomsDesFiches() {
  const noms = [];
  for (const f of etat.roman ? etat.fiches : []) {
    if (f.titre) noms.push(f.titre);
    if (f.champs?.autresNoms) noms.push(...f.champs.autresNoms.split(/[,;\n]/));
  }
  return noms;
}

// Notre correcteur remplace celui du navigateur dans les deux zones d'écriture (sinon : double soulignement)
function majCorrecteurNatif() {
  for (const id of ["texte-notes", "texte-redige"]) $(id).spellcheck = !correcteur.actif;
}

/**
 * Les fautes d'une ligne, si elle a déjà été vérifiée ; sinon une liste vide, et la ligne
 * sera vérifiée à la prochaine pause.
 */
export function fautesDeLigne(texte) {
  // (un saut de page « ──── Saut de page ──── » n'est jamais vérifié)
  if (!correcteur.actif || !LETTRE.test(texte) || estSautDePage(texte)) return [];
  const fautes = connues.get(texte);
  if (fautes) return fautes;
  aVerifier.add(texte);
  clearTimeout(minuterie);
  minuterie = setTimeout(verifier, DELAI);
  return [];
}

async function verifier() {
  const lignes = [...aVerifier].filter((l) => !connues.has(l));
  aVerifier.clear();
  if (!lignes.length || !correcteur.actif) return;
  const gen = generation;
  let fautes;
  try {
    fautes = await correcteur.verifier(lignes.join("\n"));
  } catch {
    return; // dictionnaire indisponible : rien à souligner pour l'instant
  }
  if (gen !== generation) return;
  if (connues.size > MEMOIRE_MAX) connues.clear();
  // On range les fautes ligne par ligne (positions comptées depuis le début de chaque ligne)
  let k = 0, debut = 0;
  for (const ligne of lignes) {
    const fin = debut + ligne.length;
    const siennes = [];
    for (; k < fautes.length && fautes[k].debut < fin; k++) {
      siennes.push({ ...fautes[k], debut: fautes[k].debut - debut, fin: fautes[k].fin - debut });
    }
    connues.set(ligne, siennes);
    debut = fin + 1; // (+1 : le retour à la ligne)
  }
  redessiner(false);
}

/**
 * Ouvre la bulle de suggestions sous un mot souligné.
 * @param {HTMLTextAreaElement} zone  la zone de texte
 * @param {number} position  où commence le mot dans le texte de la zone
 * @param {string} mot
 * @param {() => DOMRect | null} rectangle  la place du mot à l'écran
 */
export function proposerCorrections(zone, position, mot, rectangle) {
  ouvrirBulle({
    position: rectangle,
    mot,
    suggestions: correcteur.suggerer(mot),
    remplacer: (correction) => remplacer(zone, position, mot, correction),
    ajouter: () => correcteur.ajouter(mot),
    ignorer: () => correcteur.ignorer(mot),
  });
}

// Remplace le mot par la correction, en gardant l'historique « Ctrl+Z » (comme si on l'avait tapée)
function remplacer(zone, position, mot, correction) {
  if (zone.value.slice(position, position + mot.length) !== mot) return; // le texte a changé entre-temps
  zone.focus();
  zone.setSelectionRange(position, position + mot.length);
  if (!document.execCommand("insertText", false, correction)) {
    zone.setRangeText(correction, position, position + mot.length, "end");
    zone.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export { fermerBulle, replacerBulle };

// =====================================================================
// La fenêtre « Orthographe » : le réglage et le dictionnaire personnel
// =====================================================================

function ouvrirReglages() {
  const declencheur = document.activeElement;
  const caseActive = el("input", { type: "checkbox", id: "correction-active" });
  caseActive.checked = correcteur.actif;
  caseActive.addEventListener("change", () => correcteur.activer(caseActive.checked));
  const liste = el("div", { class: "correcteur-dictionnaire" });

  const fermer = el("button", { type: "button", class: "bouton" }, "Fermer");
  const dialogue = el("dialog", { class: "dialogue", "aria-labelledby": "titre-orthographe" },
    el("div", { class: "dialogue-form" },
      el("h2", { class: "dialogue-titre", id: "titre-orthographe" }, "Orthographe"),
      el("div", { class: "dialogue-corps" },
        el("label", { class: "case" }, caseActive, el("span", {}, "Souligner les fautes d'orthographe")),
        el("p", { class: "discret petit" },
          "Touchez un mot souligné pour voir les corrections. Les noms de vos fiches ne sont jamais soulignés. "
          + "Tout se passe sur cet appareil, même sans connexion."),
        el("h3", { class: "etiquette" }, "Dictionnaire personnel"),
        liste,
      ),
      el("div", { class: "dialogue-boutons" }, fermer),
    ),
  );
  const arreter = afficherDictionnaire(liste, correcteur, { bouton: "petit-bouton", boutonDiscret: "lien-discret", champ: "" });
  fermer.addEventListener("click", () => dialogue.close());
  dialogue.addEventListener("close", () => {
    arreter();
    dialogue.remove();
    if (declencheur?.isConnected) declencheur.focus();
  });
  document.body.append(dialogue);
  dialogue.showModal();
  caseActive.focus();
}
