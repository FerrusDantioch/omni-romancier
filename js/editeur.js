// =====================================================================
// ÉDITEUR : la zone d'écriture d'une scène
// - deux modes : Notes (fragments, puces) et Rédigé (le texte du roman),
//   ou les deux côte à côte sur un écran assez large
// - mise en forme légère : *italique*, **gras**, séparateur * * *
// - saut de page : une ligne « ──── Saut de page ──── » (voir commun/saut-de-page.js)
// - sauvegarde automatique + copie de secours instantanée
// - compteurs de mots, objectif de session, mode concentration
//
// Pourquoi une simple zone de texte (<textarea>) ? C'est l'outil le plus
// fiable pour un long texte : le navigateur gère seul le curseur, le
// copier-coller, le correcteur et l'annulation (Ctrl+Z).
// =====================================================================

import * as db from "./db.js";
import { el, nombre, pluriel, dateFichier, hauteurDansLeTexte, ecrireTexte } from "./outils.js";
import { ouvrirDialogue, informer } from "./dialogues.js";
import {
  etat, trouverScene, scenesDansLOrdre, chapitresTries, recompterScene, motsScene, motsChapitre, motsRoman, ecouter, annoncer,
} from "./etat.js";
import { afficherPlan, majComptes, marquerActive, ajouterChapitre, ajouterScene } from "./plan.js";
import { oublierHistorique } from "./annulation.js";
import { passagesDeLaScene } from "./reperage.js";
import { SAUT_DE_PAGE, corrigerSaisie, reparerSauts, difference } from "../commun/saut-de-page.js";

// Les deux zones de texte : une par mode (chacune garde son curseur ; pour Ctrl+Z, voir annulation.js)
const zones = {};
// Nom du champ enregistré pour chaque mode
const CHAMP = { notes: "notes", redige: "texte" };
// Préfixe des copies de secours (dans le « localStorage » du navigateur)
const PREFIXE_SECOURS = "atelier-secours:";
// Délai avant l'enregistrement dans la base (en millisecondes)
const DELAI_SAUVEGARDE = 500;
// Délai maximal avant la copie de secours (en millisecondes)
const DELAI_SECOURS = 300;
const OBJECTIF_PAR_DEFAUT = 500;
// Côte à côte : le choix de cet appareil (gardé dans le navigateur), et la largeur
// minimale de la colonne d'écriture pour y mettre les deux textes (en pixels)
const CLE_COTE_A_COTE = "atelier-cote-a-cote";
const LARGEUR_COTE_A_COTE = 680;

let scene = null;          // la scène ouverte
let modifiee = false;      // true = des changements ne sont pas encore dans la base
let minuterieSauvegarde = null;
let minuterieCompteurs = null;
let minuterieSecours = null;
let echecEnAttente = false; // un enregistrement a échoué : sa copie de secours attend d'être remise dans la base
const aRelire = new Set();  // modes dont le texte a changé depuis la dernière relecture
let session = null;        // { jour, motsDepart }
const curseurs = new Map(); // position du curseur de chaque scène déjà ouverte
let coteACote = false;     // « Les deux » choisi sur cet appareil
let deuxAffiches = false;  // les deux textes sont-ils affichés en ce moment ? (choix + place suffisante)
let modeAuClavier = null;  // le texte où l'on écrit (Notes ou Rédigé) ; null = celui du mode de la scène
const defilements = new Map(); // zone cachée → son défilement, rendu quand elle réapparaît
let selectionsPosees = 0;  // compteur des passages montrés (voir placerPassage)
let ouvertures = 0;        // compteur des scènes demandées (voir ouvrirScene)
let correctionEnCours = false; // une protection du saut de page modifie le texte (voir protegerSautDePage)

const $ = (id) => document.getElementById(id);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserEditeur() {
  zones.notes = $("texte-notes");
  zones.redige = $("texte-redige");

  for (const [mode, zone] of Object.entries(zones)) {
    // Le saut de page ne peut pas être abîmé : effacé d'un coup, jamais coupé (voir protegerSautDePage)
    zone.addEventListener("beforeinput", (e) => protegerSautDePage(e, zone));
    zone.addEventListener("compositionend", () => reparerSautsDe(zone));
    zone.addEventListener("input", (e) => {
      if (!scene) return;
      aRelire.add(mode);   // le texte sera relu plus tard (relire un long texte à chaque touche ralentirait)
      marquerModifiee();
      if (!e.isComposing) reparerSautsDe(zone);
    });
    zone.addEventListener("keydown", (e) => raccourcisDansLeTexte(e, mode));
    zone.addEventListener("focus", () => surFocus(mode));
  }

  // Les boutons de la barre d'outils ne « volent » pas le curseur au texte
  $("barre-outils").addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  document.querySelectorAll("#barre-outils [data-mode]").forEach((b) =>
    b.addEventListener("click", () => choisirAffichage(b.dataset.mode)));
  // Côte à côte : choix gardé d'une fois sur l'autre, et suivi de la place disponible
  try { coteACote = localStorage.getItem(CLE_COTE_A_COTE) === "oui"; } catch { /* stockage indisponible : un seul texte */ }
  new ResizeObserver(surLargeur).observe(document.querySelector(".editeur"));
  document.querySelectorAll("#barre-outils [data-format]").forEach((b) =>
    b.addEventListener("click", () => formater(b.dataset.format)));
  $("bouton-concentration").addEventListener("click", () => basculerConcentration());
  $("sortie-concentration").addEventListener("click", () => basculerConcentration(false));

  // Titre de la scène, modifiable directement
  const titre = $("titre-scene");
  titre.addEventListener("input", () => {
    if (!scene) return;
    scene.titre = titre.value;
    const etiquette = document.querySelector(`.plan-scene[data-id="${CSS.escape(scene.id)}"] .plan-titre`);
    if (etiquette) ecrireTexte(etiquette, titre.value || "Sans titre");
    marquerModifiee({ texte: false });
  });
  titre.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); zoneActive().focus(); }
  });

  // Session d'écriture
  $("bouton-objectif").addEventListener("click", changerObjectif);
  $("bouton-nouvelle-session").addEventListener("click", () => demarrerSession({ forcer: true }));
  $("bouton-premier-chapitre").addEventListener("click", () => {
    const premier = chapitresTries()[0];
    if (premier) ajouterScene(premier.id); else ajouterChapitre();
  });

  // Raccourcis clavier valables partout dans la page d'écriture
  document.addEventListener("keydown", raccourcisGeneraux);

  // Annonces venant du plan
  ecouter("ouvrir-scene", ouvrirScene);
  ecouter("scene-creee", () => { $("titre-scene").focus(); $("titre-scene").select(); });
  ecouter("scene-renommee", surRenommage);
  ecouter("scene-supprimee", surSuppression);
  ecouter("plan-change", majCompteurs);

  // Filet de sécurité : on enregistre dès que la page est cachée ou fermée
  // (la copie de secours est écrite immédiatement : elle survit même si l'onglet se ferme)
  const filetDeSecurite = () => { ecrireSecoursMaintenant(); sauverMaintenant(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) filetDeSecurite(); });
  window.addEventListener("pagehide", filetDeSecurite);
}

// Prépare l'éditeur pour le roman qui vient d'être chargé
export async function preparerEditeur() {
  scene = null;
  modifiee = false;
  curseurs.clear();
  await demarrerSession();
  const derniere = await db.lireReglage("derniereScene:" + etat.roman.id);
  const cible = trouverScene(derniere) ? derniere : scenesDansLOrdre()[0]?.id;
  if (cible) await ouvrirScene(cible);
  else afficherAucuneScene();
}

// Quand on quitte la page d'écriture
export async function fermerEditeur() {
  await sauverMaintenant();
  basculerConcentration(false);
  scene = null;
}

// Remet le curseur dans le texte, exactement où il était (utilisé par le panneau et la recherche)
export function revenirAuTexte() {
  if (scene && !$("vue-roman").hidden) zoneActive().focus({ preventScroll: true });
}

// La page d'écriture va être cachée (frise des événements) : on retient où en était le texte…
export function retenirPosition() {
  memoriserCurseur();
}
// …et, à son retour, on remet le curseur et le défilement exactement au même endroit
// (focus : false = sans y mettre le clavier, quand il doit aller ailleurs, par exemple dans une fiche)
export function retrouverPosition({ focus = true } = {}) {
  if (scene && !$("vue-roman").hidden) restaurerCurseur({ focus });
}

// Le texte où va le clavier : celui où l'on écrit, sinon celui du mode de la scène.
// (Seuls les boutons Notes et Rédigé changent le mode de la scène. Passer d'une colonne à l'autre,
// ou une fenêtre devenue trop étroite pour les deux, change seulement le texte où l'on écrit.)
function modeActif() {
  if (modeAuClavier) return modeAuClavier;
  return scene && scene.mode === "redige" ? "redige" : "notes";
}
function zoneActive() {
  return zones[modeActif()];
}

// =====================================================================
// Ouvrir une scène
// =====================================================================

// « focus : false » : le clavier reste où il est (par exemple dans la barre de recherche)
async function ouvrirScene(id, { focus = true } = {}) {
  const jeton = ++ouvertures;
  await sauverMaintenant();       // on enregistre d'abord la scène précédente
  // (deux scènes touchées très vite l'une après l'autre : seule la dernière s'ouvre, jamais dans le désordre)
  if (jeton !== ouvertures) return;
  memoriserCurseur();
  const cible = trouverScene(id);
  if (!cible) { afficherAucuneScene(); return; }

  scene = cible;
  etat.sceneId = id;
  modifiee = false;
  // Du texte non enregistré attend encore dans la copie de secours ? On le reprend.
  const reprise = reprendreSecours(scene);
  // Nouvelle scène = nouvel historique d'annulation
  // (sinon Ctrl+Z / Ctrl+Y pourraient ramener ici le texte de la scène précédente)
  oublierHistorique(zones.notes);
  oublierHistorique(zones.redige);
  zones.notes.value = scene.notes || "";
  zones.redige.value = scene.texte || "";
  $("titre-scene").value = scene.titre || "";
  $("editeur-vide").hidden = true;
  $("editeur-plein").hidden = false;
  modeAuClavier = null; // (le curseur va dans le texte du mode de la scène)
  appliquerMode();
  restaurerCurseur({ focus });
  majCompteurs();
  marquerActive(id);
  indiquerEnregistrement(echecEnAttente ? "erreur" : "enregistre"); // (un enregistrement a échoué : on le dit toujours)
  if (reprise) { afficherPlan(); marquerModifiee({ texte: reprise.texte }); } // ce qui est repris sera enregistré dans un instant
  db.ecrireReglage("derniereScene:" + etat.roman.id, id);
  annoncer("scene-affichee", id); // (le panneau cherche les fiches nommées dans la scène)
}

function afficherAucuneScene() {
  scene = null;
  etat.sceneId = null;
  // Roman sans chapitre, ou chapitres sans aucune scène : le message et le bouton le disent
  const vide = !etat.chapitres.length;
  ecrireTexte($("editeur-vide-titre"), vide ? "Ce roman est encore vide" : "Aucune scène pour l'instant");
  ecrireTexte($("editeur-vide-texte"), vide
    ? "Créez un premier chapitre : une première scène sera ouverte, prête à recevoir vos notes."
    : "Ajoutez une scène (« + Scène » dans le plan) : elle s'ouvrira, prête à recevoir vos notes.");
  ecrireTexte($("bouton-premier-chapitre"), vide ? "Créer le premier chapitre" : "Ajouter une scène");
  $("editeur-vide").hidden = false;
  $("editeur-plein").hidden = true;
  majCompteurs();
  annoncer("scene-affichee", null);
}

// Une scène vient d'être supprimée : si c'était la scène ouverte, on ouvre sa voisine
async function surSuppression({ voisine = null } = {}) {
  if (scene && !trouverScene(scene.id)) {
    effacerSecours(scene.id);
    scene = null;
    modifiee = false;
    const suivante = trouverScene(voisine) || scenesDansLOrdre()[0];
    if (suivante) await ouvrirScene(suivante.id);
    else afficherAucuneScene();
  }
  majCompteurs();
}

// Retient où était le curseur dans chaque mode, pour y revenir plus tard
function memoriserCurseur() {
  if (!scene) return;
  const position = (z) => ({ debut: z.selectionStart, fin: z.selectionEnd, defilement: z.hidden ? defilements.get(z) ?? 0 : z.scrollTop });
  curseurs.set(scene.id, { notes: position(zones.notes), redige: position(zones.redige) });
}
function restaurerCurseur({ focus = true } = {}) {
  const memo = curseurs.get(scene.id);
  for (const [mode, zone] of Object.entries(zones)) {
    // (première ouverture : curseur à la fin, là où l'on reprend l'écriture)
    const debut = memo ? memo[mode].debut : zone.value.length, fin = memo ? memo[mode].fin : zone.value.length;
    const defilement = memo ? memo[mode].defilement : 1e9; // (trop grand : le texte défile jusqu'en bas)
    zone.setSelectionRange(debut, fin);
    // Une zone cachée ne peut pas défiler : elle le fera quand elle réapparaîtra
    if (zone.hidden) defilements.set(zone, defilement); else zone.scrollTop = defilement;
  }
  if (focus) zoneActive().focus({ preventScroll: true });
}

// =====================================================================
// Aller à un passage (depuis une fiche : « Nommé dans ces scènes » ; depuis « Rechercher »)
// =====================================================================

// Ouvre la scène au premier passage où la fiche est nommée (le texte rédigé d'abord, puis les notes).
// Dans la scène déjà ouverte : au passage qui suit le curseur (après le dernier, de nouveau au premier).
// Le nom est sélectionné, et sa ligne amenée au tiers de la hauteur du texte.
// (Si le nom est dans les notes, ce sont elles qui s'affichent, sans changer le mode de la scène.)
export async function allerAuNom(sceneId, ficheId) {
  const autreScene = !scene || scene.id !== sceneId;
  if (autreScene) {
    await ouvrirScene(sceneId);
    if (!scene || scene.id !== sceneId) return;
  }
  const passages = passagesDeLaScene(scene, { notes: zones.notes.value, texte: zones.redige.value }).get(ficheId);
  const liste = passages
    ? [...passages.redige.map((p) => ({ mode: "redige", ...p })), ...passages.notes.map((p) => ({ mode: "notes", ...p }))]
    : [];
  if (!liste.length) { zoneActive().focus({ preventScroll: true }); return; } // (le nom vient d'être effacé)
  let cible = liste[0];
  if (!autreScene) {
    const rang = (mode) => (mode === "redige" ? 0 : 1);
    const ici = modeActif(), curseur = zoneActive().selectionStart;
    cible = liste.find((p) => rang(p.mode) > rang(ici) || (p.mode === ici && p.debut > curseur)) || liste[0];
  }
  placerPassage(cible.mode, cible.debut, cible.fin);
}

// Montre un passage d'une scène (pour « Rechercher et remplacer ») : la scène s'ouvre au besoin,
// le bon texte s'affiche (Notes ou Rédigé, sans changer le mode de la scène), le passage est sélectionné.
// Le clavier reste où il est (dans la barre de recherche) ; le texte ne défile que si le passage
// n'est pas déjà bien visible (passer au résultat suivant, sur le même écran, ne fait pas sauter le texte).
export async function montrerPassage(sceneId, mode, debut, fin) {
  if (!scene || scene.id !== sceneId) {
    await ouvrirScene(sceneId, { focus: false });
    if (!scene || scene.id !== sceneId) return false;
  }
  placerPassage(mode, debut, fin, { focus: false, toujours: false });
  return true;
}

// Sélectionne un passage, et amène sa ligne au tiers de la hauteur du texte
// (« toujours : false » : seulement si elle n'est pas déjà bien visible)
function placerPassage(mode, debut, fin, { focus = true, toujours = true } = {}) {
  modeAuClavier = mode;
  appliquerMode();
  const zone = zones[mode];
  if (focus) zone.focus({ preventScroll: true });
  zone.setSelectionRange(debut, fin);
  if (!focus) {
    // (juste après un clic sur un bouton, Chrome remet parfois le curseur du texte qui vient de perdre
    // le clavier, à la place de cette sélection : on la repose un instant plus tard, si rien ne l'a changée)
    const jeton = ++selectionsPosees;
    setTimeout(() => {
      if (jeton !== selectionsPosees || document.activeElement === zone) return;
      if (zone.selectionStart !== debut || zone.selectionEnd !== fin) zone.setSelectionRange(debut, fin);
    }, 0);
  }
  const haut = hauteurDansLeTexte(zone, debut);
  const place = haut - zone.scrollTop, ligne = parseFloat(getComputedStyle(zone).lineHeight) || 30;
  if (toujours || place < zone.clientHeight * 0.1 || place + ligne > zone.clientHeight * 0.8) {
    zone.scrollTop = Math.max(0, haut - zone.clientHeight / 3);
  }
}

// Le texte d'une scène tel qu'il est en ce moment (pour la scène ouverte : celui qui est à l'écran)
export function textesActuels(id) {
  if (scene && scene.id === id) return { notes: zones.notes.value, texte: zones.redige.value };
  const s = trouverScene(id);
  return s ? { notes: s.notes || "", texte: s.texte || "" } : null;
}

// Où est le curseur : la scène ouverte, le texte où l'on écrit (Notes ou Rédigé), la position dans ce texte
export function positionDuCurseur() {
  if (!scene) return null;
  const mode = modeActif();
  return { sceneId: scene.id, mode, position: zones[mode].selectionStart };
}

// =====================================================================
// Modes Notes / Rédigé
// =====================================================================

// Les boutons Notes / Rédigé / Les deux
function choisirAffichage(choix) {
  if (!scene) return;
  if (choix === "deux") {
    retenirCoteACote(true);
    appliquerMode();
    zoneActive().focus({ preventScroll: true });
    return;
  }
  if (deuxAffiches) retenirCoteACote(false); // Notes ou Rédigé seul : on quitte le côte à côte
  changerMode(choix);
}

function retenirCoteACote(oui) {
  coteACote = oui;
  try { localStorage.setItem(CLE_COTE_A_COTE, oui ? "oui" : "non"); } catch { /* tant pis : le choix vaut pour cette fois */ }
}

function changerMode(mode) {
  if (!scene) return;
  modeAuClavier = mode;
  if (scene.mode !== mode) {
    scene.mode = mode;
    marquerModifiee({ texte: false });
    afficherPlan(); // met à jour la petite mention « notes » dans le plan
  }
  appliquerMode();
  zoneActive().focus({ preventScroll: true }); // (le texte reste à l'endroit où on l'avait laissé)
}

// Affiche le texte où l'on écrit, ou les deux textes côte à côte (si c'est le choix et qu'il y a la place)
function appliquerMode() {
  deuxAffiches = coteACote && assezLarge();
  const mode = modeActif();
  $("vue-roman").classList.toggle("cote-a-cote", deuxAffiches);
  const reapparues = [];
  for (const [m, zone] of Object.entries(zones)) {
    const visible = deuxAffiches || m === mode;
    if (visible === !zone.hidden) continue;
    if (visible) reapparues.push(zone); else defilements.set(zone, zone.scrollTop);
    zone.hidden = !visible;
  }
  for (const zone of reapparues) zone.scrollTop = defilements.get(zone) ?? 0;
  majIndicateurs();
  annoncer("mode-affiche", mode);     // (les noms en couleur suivent les textes affichés)
}

// Le bouton enfoncé (Notes, Rédigé ou Les deux), et le texte où va le clavier
function majIndicateurs() {
  const choix = deuxAffiches ? "deux" : modeActif();
  document.querySelectorAll("#barre-outils [data-mode]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === choix)));
  // Sert au style : bouton « puce » seulement pour les notes, titre de la colonne où l'on écrit
  $("vue-roman").dataset.mode = modeActif();
}

function assezLarge() {
  return document.querySelector(".editeur").clientWidth >= LARGEUR_COTE_A_COTE;
}

// Côte à côte : cliquer dans l'autre texte y fait aller les boutons de mise en forme
// (sans changer le mode de la scène : c'est seulement l'endroit où l'on écrit)
function surFocus(mode) {
  if (!scene || modeAuClavier === mode) return;
  modeAuClavier = mode;
  majIndicateurs();
}

// La colonne d'écriture a changé de largeur (fenêtre, volets, concentration…)
function surLargeur() {
  if (!document.querySelector(".editeur").clientWidth) return; // page d'écriture cachée (frise, bibliothèque…)
  const large = assezLarge();
  $("bouton-deux").hidden = !large; // « Les deux » n'est proposé que s'il y a la place
  // (plus assez de place pour les deux : reste affiché le texte où l'on écrivait)
  if (scene && coteACote && large !== deuxAffiches) appliquerMode();
}

// Une scène renommée depuis le plan : son titre ici, et dans sa copie de secours si elle en attend une
// (sinon, à la prochaine ouverture, la copie ramènerait l'ancien titre)
function surRenommage(id) {
  const s = trouverScene(id);
  if (!s) return;
  if (scene && scene.id === id) $("titre-scene").value = s.titre;
  const secours = lireSecours(id);
  if (!secours) return;
  try { localStorage.setItem(PREFIXE_SECOURS + id, JSON.stringify({ ...secours, titre: s.titre })); } catch { /* rien */ }
}

// =====================================================================
// Mise en forme (*italique*, **gras**, séparateur, puces)
// =====================================================================

// Insère du texte à la place de la sélection, en gardant l'historique « Ctrl+Z »
function inserer(zone, texte) {
  zone.focus();
  const ok = texte === ""
    ? document.execCommand("delete")
    : document.execCommand("insertText", false, texte);
  if (!ok) {
    // Solution de repli pour les navigateurs qui refusent execCommand
    zone.setRangeText(texte, zone.selectionStart, zone.selectionEnd, "end");
    zone.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Avec n étoiles de chaque côté, le texte est-il déjà dans ce style ?
// (* = italique, ** = gras, *** = les deux)
function dejaEnForme(n, symbole) {
  return symbole === "*" ? (n === 1 || n === 3) : n >= 2;
}

// Entoure la sélection de symboles (ou les retire s'ils y sont déjà)
function entourer(zone, symbole) {
  const v = zone.value;
  const L = symbole.length;
  let debut = zone.selectionStart, fin = zone.selectionEnd;
  // Les espaces et retours à la ligne au bord de la sélection restent dehors (« *mot* » et non « *mot * »)
  while (debut < fin && /\s/.test(v[debut])) debut++;
  while (fin > debut && /\s/.test(v[fin - 1])) fin--;
  // Sélection de plusieurs paragraphes : chacun est mis en forme séparément
  if (v.slice(debut, fin).includes("\n")) { entourerLignes(zone, symbole, debut, fin); return; }
  // Les étoiles sélectionnées avec le mot (« *mot* » en entier) comptent comme étant autour
  while (fin - debut >= 2 && v[debut] === "*" && v[fin - 1] === "*") { debut++; fin--; }
  const choisi = v.slice(debut, fin);
  let avant = 0, apres = 0;
  while (v[debut - 1 - avant] === "*") avant++;
  while (v[fin + apres] === "*") apres++;
  if (dejaEnForme(Math.min(avant, apres), symbole)) {
    zone.setSelectionRange(debut - L, fin + L);
    inserer(zone, choisi);
    zone.setSelectionRange(debut - L, fin - L);
  } else {
    zone.setSelectionRange(debut, fin);
    inserer(zone, symbole + choisi + symbole);
    zone.setSelectionRange(debut + L, fin + L); // garde le mot sélectionné (ou le curseur entre les symboles)
  }
}

// Mise en forme d'une sélection sur plusieurs lignes : chaque ligne de texte est entourée
// (ou libérée, si toutes l'étaient déjà). Les lignes vides et les « * * * » ne bougent pas.
function entourerLignes(zone, symbole, debut, fin) {
  const L = symbole.length;
  const etoiles = (t) => Math.min(t.match(/^\**/)[0].length, t.match(/\**$/)[0].length);
  const lignes = zone.value.slice(debut, fin).split("\n").map((ligne) => {
    const [, avant, coeur, apres] = ligne.match(/^(\s*)(.*?)(\s*)$/);
    const aMettre = coeur !== "" && !/^\*(\s*\*)*$/.test(coeur); // ni vide, ni séparateur
    return { avant, coeur, apres, aMettre };
  });
  const aTraiter = lignes.filter((l) => l.aMettre);
  if (!aTraiter.length) return;
  const retirer = aTraiter.every((l) => l.coeur.length > 2 * L && dejaEnForme(etoiles(l.coeur), symbole));
  const nouveau = lignes.map((l) => {
    if (!l.aMettre) return l.avant + l.coeur + l.apres;
    return l.avant + (retirer ? l.coeur.slice(L, -L) : symbole + l.coeur + symbole) + l.apres;
  }).join("\n");
  zone.setSelectionRange(debut, fin);
  inserer(zone, nouveau);
  zone.setSelectionRange(debut, debut + nouveau.length);
}

// Début de la ligne où se trouve la position « pos »
function debutDeLigne(texte, pos) {
  return pos === 0 ? 0 : texte.lastIndexOf("\n", pos - 1) + 1;
}

// Insère le séparateur de scène « * * * » sur sa propre ligne, entouré de lignes vides
function insererSeparateur(zone) {
  const avant = zone.value.slice(0, zone.selectionStart);
  const prefixe = avant === "" || avant.endsWith("\n\n") ? "" : avant.endsWith("\n") ? "\n" : "\n\n";
  inserer(zone, prefixe + "* * *\n\n");
}

// Insère un saut de page au curseur, sur sa propre ligne ; le curseur va à la ligne d'après,
// prêt à écrire la suite (qui commencera sur une nouvelle page dans le PDF, l'ePub et le Word)
function insererSautDePage(zone) {
  const avant = zone.value.slice(0, zone.selectionStart);
  const prefixe = avant === "" || avant.endsWith("\n") ? "" : "\n";
  inserer(zone, prefixe + SAUT_DE_PAGE + "\n");
}

// Protège les sauts de page pendant l'écriture (règles dans commun/saut-de-page.js) :
// un retour arrière (ou Suppr) qui touche un saut de page l'efface en entier, d'un coup ;
// le texte tapé sur sa ligne va sur la ligne d'à côté. Ctrl+Z le fait revenir.
function protegerSautDePage(e, zone) {
  if (correctionEnCours || e.isComposing || !e.cancelable) return;
  const type = e.inputType;
  let action = "inserer", donnee = "";
  if (type.startsWith("delete") && type.endsWith("Backward")) action = "arriere";
  else if (type.startsWith("delete") && type.endsWith("Forward")) action = "avant";
  else if (type === "insertLineBreak" || type === "insertParagraph") donnee = "\n";
  else if (type === "insertText" || type === "insertReplacementText" || type === "insertFromPaste" || type === "insertFromDrop") {
    donnee = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
  } else return;
  const correction = corrigerSaisie(zone.value, zone.selectionStart, zone.selectionEnd, action, donnee);
  if (!correction) return; // aucun saut de page touché : le navigateur fait la modification lui-même
  e.preventDefault();
  remplacerDans(zone, correction);
  zone.setSelectionRange(correction.curseur, correction.curseur);
}

// Solution de secours : un clavier de téléphone a pu abîmer un saut de page sans prévenir
// (pendant la « composition » d'un mot). On le remet d'aplomb après coup.
function reparerSautsDe(zone) {
  if (correctionEnCours || !zone.value.includes("─")) return;
  const nouveau = reparerSauts(zone.value);
  if (nouveau === null) return;
  const changement = difference(zone.value, nouveau);
  // Le curseur garde sa place dans le texte (décalée si le changement est avant lui)
  const curseur = zone.selectionEnd;
  const ecart = changement.remplacement.length - (changement.fin - changement.debut);
  const apres = curseur >= changement.fin ? curseur + ecart
    : curseur > changement.debut ? changement.debut + changement.remplacement.length : curseur;
  remplacerDans(zone, changement);
  zone.setSelectionRange(apres, apres);
}

// Remplace un passage du texte en gardant l'historique « Ctrl+Z » (sans relancer la protection)
function remplacerDans(zone, { debut, fin, remplacement }) {
  correctionEnCours = true;
  try {
    zone.setSelectionRange(debut, fin);
    inserer(zone, remplacement);
  } finally {
    correctionEnCours = false;
  }
}

// Ajoute (ou retire) une puce « - » au début de la ligne du curseur
function basculerPuce(zone) {
  const curseur = zone.selectionStart;
  const debutLigne = debutDeLigne(zone.value, curseur);
  if (zone.value.startsWith("- ", debutLigne)) {
    zone.setSelectionRange(debutLigne, debutLigne + 2);
    inserer(zone, "");
    zone.setSelectionRange(Math.max(debutLigne, curseur - 2), Math.max(debutLigne, curseur - 2));
  } else {
    zone.setSelectionRange(debutLigne, debutLigne);
    inserer(zone, "- ");
    zone.setSelectionRange(curseur + 2, curseur + 2);
  }
}

function formater(type) {
  if (!scene) return;
  const zone = zoneActive();
  zone.focus();
  if (type === "italique") entourer(zone, "*");
  else if (type === "gras") entourer(zone, "**");
  else if (type === "separateur") insererSeparateur(zone);
  else if (type === "saut-de-page") insererSautDePage(zone);
  else if (type === "puce") basculerPuce(zone);
}

// Raccourcis à l'intérieur de la zone de texte
function raccourcisDansLeTexte(e, mode) {
  const zone = zones[mode];
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey) {
    const touche = e.key.toLowerCase();
    if (touche === "i") { e.preventDefault(); entourer(zone, "*"); return; }
    if (touche === "b") { e.preventDefault(); entourer(zone, "**"); return; }
    // Ctrl+Entrée : saut de page (le même raccourci que dans Omni-Texte, Word et LibreOffice)
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); insererSautDePage(zone); return; }
  }
  // Mode Notes : « Entrée » sur une ligne à puce crée une nouvelle puce
  if (mode === "notes" && e.key === "Enter" && !ctrl && !e.shiftKey && !e.altKey && !e.isComposing
      && zone.selectionStart === zone.selectionEnd) {
    const debutLigne = debutDeLigne(zone.value, zone.selectionStart);
    const ligne = zone.value.slice(debutLigne, zone.selectionStart);
    const puce = ligne.match(/^(\s*)([-•])\s(.*)$/);
    if (!puce) return;
    e.preventDefault();
    let finLigne = zone.value.indexOf("\n", zone.selectionStart);
    if (finLigne < 0) finLigne = zone.value.length;
    const reste = zone.value.slice(zone.selectionStart, finLigne);
    if (puce[3].trim() === "" && reste.trim() === "") {
      // Puce vide + Entrée : on retire la puce (fin de la liste)
      zone.setSelectionRange(debutLigne, zone.selectionStart);
      inserer(zone, "");
    } else {
      inserer(zone, "\n" + puce[1] + puce[2] + " ");
    }
  }
}

// Raccourcis valables dans toute la page d'écriture
function raccourcisGeneraux(e) {
  if ($("vue-roman").hidden) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const dialogueOuvert = !!document.querySelector("dialog[open]");
  // Ctrl+Maj+F : mode concentration
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "f" && !dialogueOuvert) {
    e.preventDefault();
    basculerConcentration();
  // Échap : quitter la concentration
  } else if (e.key === "Escape" && document.body.classList.contains("concentration") && !dialogueOuvert) {
    e.preventDefault();
    basculerConcentration(false);
  // Ctrl+S : par habitude… on enregistre (c'est déjà automatique)
  } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    sauverMaintenant().then(() => informer("Enregistré. (L'enregistrement est automatique : pas besoin de Ctrl+S.)"));
  }
}

// =====================================================================
// Mode concentration : seul le texte reste visible
// =====================================================================

export function quitterConcentration() {
  if (document.body.classList.contains("concentration")) basculerConcentration(false);
}

function basculerConcentration(forcer) {
  const actif = document.body.classList.toggle("concentration", forcer);
  // Les volets (plan, fiches) se referment : sinon leur voile sombre resterait sur le texte
  if (actif) {
    $("vue-roman").classList.remove("plan-ouvert", "panneau-ouvert");
    $("bouton-fiches").setAttribute("aria-expanded", "false");
  }
  if (scene) zoneActive().focus({ preventScroll: true });
  $("bouton-concentration").setAttribute("aria-pressed", String(actif));
}

// =====================================================================
// Enregistrement automatique
// =====================================================================

// Recopie le contenu des zones de texte modifiées dans la scène
function relire() {
  if (!scene) return;
  for (const mode of aRelire) scene[CHAMP[mode]] = zones[mode].value;
  aRelire.clear();
}

// Recopie tout de suite les zones de texte dans la scène (utilisé par l'export PDF)
export function relireMaintenant() {
  relire();
}

// « texte : false » : seuls le titre ou le mode ont changé. La date de la scène ne bouge pas :
// la fusion entre appareils ne confond pas ces gestes avec une réécriture du texte.
function marquerModifiee({ texte = true } = {}) {
  if (texte) scene.modifie = Date.now();
  modifiee = true;
  // Copie de secours au plus toutes les 0,3 s (et tout de suite si l'onglet se ferme)
  if (!minuterieSecours) minuterieSecours = setTimeout(ecrireSecoursMaintenant, DELAI_SECOURS);
  indiquerEnregistrement("en-cours");
  clearTimeout(minuterieSauvegarde);
  minuterieSauvegarde = setTimeout(sauverMaintenant, DELAI_SAUVEGARDE);
  clearTimeout(minuterieCompteurs);
  minuterieCompteurs = setTimeout(majCompteurs, 250);
}

// Enregistre tout de suite dans la base (si quelque chose a changé)
export async function sauverMaintenant() {
  clearTimeout(minuterieSauvegarde);
  if (!scene || !modifiee) return;
  const objet = scene;
  if (!trouverScene(objet.id)) { modifiee = false; return; } // scène supprimée entre-temps
  modifiee = false;
  relire();
  const copie = { ...objet };
  etat.roman.modifie = Math.max(etat.roman.modifie || 0, copie.modifie || 0);
  try {
    await db.lot({ ecrire: { scenes: [copie], romans: [etat.roman] } });
    // Plus besoin de la copie de secours… sauf si l'on a retapé quelque chose entre-temps
    if (!(scene === objet && modifiee)) effacerSecours(copie.id);
    // (la minuterie de secours et le témoin « Enregistré » sont ceux de la scène affichée :
    // on n'y touche que si c'est encore elle, sinon on effacerait ceux de la scène ouverte entre-temps)
    if (scene === objet && !modifiee) {
      clearTimeout(minuterieSecours);
      minuterieSecours = null;
      indiquerEnregistrement("enregistre");
    }
    // La base fonctionne de nouveau : on y remet aussi les scènes dont l'enregistrement avait échoué
    if (echecEnAttente) {
      echecEnAttente = false;
      await recupererSecours({ sauf: scene && scene.id });
    }
  } catch (erreur) {
    echecEnAttente = true;
    if (scene === objet) modifiee = true;
    // La copie de secours est écrite tout de suite, avec ce texte : même si l'on change de scène ou
    // quitte le roman aussitôt après, il sera remis dans la base dès qu'elle fonctionnera de nouveau
    ecrireSecoursDe(copie);
    indiquerEnregistrement("erreur");
    informer("L'enregistrement a échoué : " + erreur.message + ". Votre texte est gardé en secours.", { erreur: true });
  }
}

function indiquerEnregistrement(etatEnr) {
  const zone = $("etat-enregistrement");
  if (zone.dataset.etat === etatEnr) return; // rien à changer : on évite de redessiner à chaque touche
  zone.dataset.etat = etatEnr;
  ecrireTexte(zone, { "en-cours": "Enregistrement…", enregistre: "Enregistré ✓", erreur: "Non enregistré !" }[etatEnr]);
}

// ---------- Copie de secours (localStorage : une écriture instantanée, qui survit à la fermeture) ----------

function ecrireSecoursMaintenant() {
  clearTimeout(minuterieSecours);
  minuterieSecours = null;
  if (!scene || !modifiee) return;
  relire();
  ecrireSecoursDe(scene);
}
function ecrireSecoursDe(s) {
  try {
    localStorage.setItem(PREFIXE_SECOURS + s.id, JSON.stringify({
      sceneId: s.id, titre: s.titre, notes: s.notes, texte: s.texte, mode: s.mode, t: s.modifie,
    }));
  } catch {
    // Mémoire de secours pleine ou indisponible : l'enregistrement normal continue
  }
}
function effacerSecours(id) {
  try { localStorage.removeItem(PREFIXE_SECOURS + id); } catch { /* rien */ }
}
function clesSecours() {
  const cles = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i);
      if (cle.startsWith(PREFIXE_SECOURS)) cles.push(cle);
    }
  } catch { /* localStorage indisponible */ }
  return cles;
}

// Lit la copie de secours d'une scène (ou null)
function lireSecours(id) {
  try {
    const secours = JSON.parse(localStorage.getItem(PREFIXE_SECOURS + id));
    return secours && typeof secours === "object" && typeof secours.sceneId === "string" ? secours : null;
  } catch {
    return null;
  }
}

// La copie de secours contient-elle du texte plus récent que la scène ?
function secoursPlusRecent(secours, s) {
  const differente = s.texte !== secours.texte || s.notes !== secours.notes
    || s.titre !== secours.titre || s.mode !== secours.mode;
  return differente && (s.modifie || 0) <= secours.t;
}

// À l'ouverture d'une scène : une copie de secours qui attend encore veut dire que son
// texte n'a jamais été confirmé dans la base (enregistrement qui avait échoué).
// On reprend son contenu s'il est plus récent, et on renvoie { texte } : la scène sera réenregistrée
// (texte : true si le texte lui-même a changé, false si ce n'était que le titre ou le mode).
function reprendreSecours(s) {
  const secours = lireSecours(s.id);
  if (!secours || (s.modifie || 0) > secours.t) return false; // pas de copie, ou copie dépassée
  let texte = false;
  if (secoursPlusRecent(secours, s)) {
    texte = s.notes !== secours.notes || s.texte !== secours.texte;
    Object.assign(s, { titre: secours.titre, notes: secours.notes, texte: secours.texte, mode: secours.mode });
    recompterScene(s.id);
  }
  return { texte };
}

// Au démarrage et à l'ouverture d'un roman : remet dans la base les frappes qui
// n'avaient pas eu le temps d'être enregistrées (onglet fermé en pleine phrase, panne…).
// Une copie de secours n'est effacée que lorsqu'on est SÛR de ne plus en avoir besoin.
// « sauf » : la scène ouverte, dont l'éditeur s'occupe lui-même.
export async function recupererSecours({ sauf = null } = {}) {
  let recuperees = 0, gardees = 0, enMemoire = false;
  for (const cle of clesSecours()) {
    if (sauf && cle === PREFIXE_SECOURS + sauf) continue;
    const secours = lireSecours(cle.slice(PREFIXE_SECOURS.length));
    if (!secours) { effacerCle(cle); continue; } // copie illisible : inutilisable
    try {
      const enBase = await db.lire("scenes", secours.sceneId);
      if (enBase && secoursPlusRecent(secours, enBase)) {
        const repris = { titre: secours.titre, notes: secours.notes, texte: secours.texte, mode: secours.mode, modifie: secours.t };
        await db.ecrire("scenes", { ...enBase, ...repris });
        // (le roman ouvert garde aussi ce texte en mémoire : sinon, la prochaine écriture de cette
        // scène — la modifier, la déplacer, l'exporter — repartirait de l'ancien texte)
        const s = trouverScene(secours.sceneId);
        if (s && s !== scene) { Object.assign(s, repris); recompterScene(s.id); enMemoire = true; }
        recuperees++;
      }
      effacerCle(cle); // remise dans la base, ou plus utile (scène supprimée, base déjà à jour)
    } catch {
      gardees++;       // la base refuse pour l'instant : on GARDE la copie pour un prochain essai
    }
  }
  if (enMemoire && etat.roman) afficherPlan(); // (leurs nombres de mots)
  if (recuperees) informer(`Texte récupéré : ${pluriel(recuperees, "scène")} n'avai${recuperees > 1 ? "en" : ""}t pas fini d'être enregistrée${recuperees > 1 ? "s" : ""}.`);
  if (gardees) {
    echecEnAttente = true;
    informer("Du texte non enregistré est gardé en secours, mais n'a pas encore pu être remis dans le roman. "
      + "Il sera repris à l'ouverture de la scène. N'effacez pas les données du navigateur.", { erreur: true, duree: 15000 });
  }
}
function effacerCle(cle) {
  try { localStorage.removeItem(cle); } catch { /* rien */ }
}

// Avant un export : tout ce qui attend (frappes récentes, copies de secours) va dans la base.
// Renvoie false si du texte n'a pas pu y être mis (il manquerait alors dans le fichier).
export async function toutEnregistrer() {
  await sauverMaintenant();
  // (la scène ouverte, si elle a encore des frappes en attente, est laissée à l'éditeur)
  await recupererSecours({ sauf: scene && modifiee ? scene.id : null });
  return !modifiee && clesSecours().length === 0;
}

// =====================================================================
// Remplacer du texte dans plusieurs scènes d'un coup (« Rechercher et remplacer »)
// =====================================================================

// changements : [{ id, avant: { notes, texte }, apres: { notes, texte } }] (les textes complets).
// Chaque scène doit avoir encore exactement le texte « avant » : sinon, rien n'est fait.
// Tout est écrit dans la base en une seule fois (tout ou rien), puis affiché.
// Dans la scène ouverte, seule la partie qui change est réécrite : le défilement et le curseur
// restent en place ; l'historique Ctrl+Z du navigateur de ce texte repart de zéro (il ne
// correspondrait plus au texte : c'est remplacer.js qui sait annuler un remplacement).
// Renvoie "ok", "change" (un texte a changé entre-temps) ou "attente" (du texte attend encore
// d'être enregistré). Si la base refuse d'écrire, l'erreur est transmise et rien n'a changé.
export async function remplacerTextes(changements) {
  // Pendant ce court moment, on ne peut pas taper dans le texte (la frappe serait écrasée)
  zones.notes.readOnly = zones.redige.readOnly = true;
  try {
    await sauverMaintenant();
    if (modifiee || clesSecours().length) return "attente";
    const pareil = (a, b) => a.notes === (b.notes || "") && a.texte === (b.texte || "");
    const maintenant = Date.now();
    const copies = [];
    for (const c of changements) {
      const actuels = textesActuels(c.id);
      if (!actuels || !pareil(actuels, c.avant)) return "change";
      copies.push({ ...trouverScene(c.id), notes: c.apres.notes, texte: c.apres.texte, modifie: maintenant });
    }
    if (!copies.length) return "ok";
    const roman = { ...etat.roman, modifie: Math.max(etat.roman.modifie || 0, maintenant) };
    await db.lot({ ecrire: { scenes: copies, romans: [roman] } });
    etat.roman.modifie = roman.modifie;
    let ouverteChangee = false;
    for (const copie of copies) {
      const s = trouverScene(copie.id);
      if (!s) continue;
      Object.assign(s, { notes: copie.notes, texte: copie.texte, modifie: maintenant });
      recompterScene(s.id);
      if (s === scene) {
        remettreTexte(zones.notes, s.notes);
        remettreTexte(zones.redige, s.texte);
        ouverteChangee = true;
      }
    }
    afficherPlan(); // (les nombres de mots de chaque scène)
    if (ouverteChangee) annoncer("scene-affichee", scene.id); // (noms en couleur, fiches nommées… suivent le texte)
    annoncer("plan-change");
    return "ok";
  } finally {
    zones.notes.readOnly = zones.redige.readOnly = false;
  }
}

// Réécrit seulement la partie d'un texte qui a changé : le curseur et le défilement restent en place
function remettreTexte(zone, nouveau) {
  const ancien = zone.value;
  if (ancien === nouveau) return;
  const max = Math.min(ancien.length, nouveau.length);
  let debut = 0, fin = 0;
  while (debut < max && ancien[debut] === nouveau[debut]) debut++;
  while (fin < max - debut && ancien[ancien.length - 1 - fin] === nouveau[nouveau.length - 1 - fin]) fin++;
  const defilement = zone.scrollTop;
  zone.setRangeText(nouveau.slice(debut, nouveau.length - fin), debut, ancien.length - fin, "preserve");
  if (!zone.hidden) zone.scrollTop = defilement;
  oublierHistorique(zone);
}

// Après un import, les anciennes copies de secours n'ont plus de sens
export function effacerTousLesSecours() {
  for (const cle of clesSecours()) {
    try { localStorage.removeItem(cle); } catch { /* rien */ }
  }
}

// =====================================================================
// Compteurs de mots et objectif de session
// =====================================================================

function majCompteurs() {
  if (!etat.roman) return;
  relire();
  if (scene) {
    recompterScene(scene.id);
    ecrireTexte($("mots-scene"), nombre(motsScene(scene.id)));
    ecrireTexte($("mots-scene-libelle"), motsScene(scene.id) > 1 ? "mots rédigés" : "mot rédigé");
    ecrireTexte($("mots-chapitre"), nombre(motsChapitre(scene.chapitreId)));
    majComptes(scene.id);
  }
  ecrireTexte($("mots-roman"), pluriel(motsRoman(), "mot"));
  majSession();
}

// La session redémarre chaque jour (ou à la demande).
// Elle note le nombre de mots de chaque scène au départ, et compte ce qui a été ajouté
// depuis. Ainsi, supprimer une ancienne scène n'efface pas le travail du jour.
async function demarrerSession({ forcer = false } = {}) {
  const romanId = etat.roman.id;
  const cle = "session:" + romanId;
  const jour = dateFichier();
  let s = await db.lireReglage(cle);
  if (forcer || !s || s.jour !== jour || !s.depart) {
    s = { jour, depart: Object.fromEntries(etat.scenes.map((x) => [x.id, motsScene(x.id)])) };
    session = s;
    majSession();
    if (forcer) informer("Nouvelle session : le compteur repart de zéro.");
    try { await db.ecrireReglage(cle, s); } catch { /* le compteur marche quand même pour aujourd'hui */ }
  }
  if (etat.roman && etat.roman.id === romanId) session = s;
  majSession();
}

// Mots ajoutés depuis le début de la session (une scène créée aujourd'hui part de 0)
function motsDeLaSession() {
  let total = 0;
  for (const s of etat.scenes) total += motsScene(s.id) - (session.depart[s.id] || 0);
  return Math.max(0, total);
}

function majSession() {
  if (!session || !etat.roman) return;
  // L'application est restée ouverte après minuit : nouvelle journée, nouvelle session
  if (session.jour !== dateFichier()) { session = null; demarrerSession(); return; }
  const objectif = etat.roman.objectifSession || OBJECTIF_PAR_DEFAUT;
  const ecrits = motsDeLaSession();
  const pourcentage = Math.min(100, Math.round((ecrits / objectif) * 100));
  ecrireTexte($("mots-session"), nombre(ecrits));
  ecrireTexte($("objectif-session"), nombre(objectif));
  const barre = $("barre-session");
  barre.setAttribute("aria-valuenow", pourcentage);
  barre.style.setProperty("--progression", pourcentage + "%");
  barre.classList.toggle("atteint", ecrits >= objectif);
}

async function changerObjectif() {
  const actuel = etat.roman.objectifSession || OBJECTIF_PAR_DEFAUT;
  const valeur = await ouvrirDialogue({
    titre: "Objectif de la session",
    corps: [
      el("label", { class: "champ" },
        el("span", { class: "etiquette" }, "Nombre de mots à écrire par session"),
        el("input", { type: "number", name: "objectif", value: actuel, min: 1, max: 100000, step: 1 }),
      ),
      el("p", { class: "discret petit" }, "La session redémarre chaque jour, ou quand vous cliquez sur « Nouvelle session »."),
    ],
    ok: "Enregistrer",
    lireFormulaire: (form) => {
      const n = Math.round(Number(form.elements.objectif.value));
      return n >= 1 && n <= 100000 ? n : "Indiquez un nombre entre 1 et 100 000.";
    },
  });
  if (!valeur) return;
  etat.roman.objectifSession = valeur;
  await db.ecrire("romans", etat.roman);
  majSession();
}
