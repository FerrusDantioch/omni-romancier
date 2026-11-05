// =====================================================================
// ÉTAT DU ROMAN OUVERT
// Une copie en mémoire du roman en cours (chapitres, scènes, nombre de mots),
// partagée par le plan, l'éditeur et (plus tard) le panneau de consultation.
// =====================================================================

import * as db from "./db.js";
import { compterMots } from "./outils.js";

export const etat = {
  roman: null,     // le roman ouvert
  chapitres: [],   // ses chapitres
  scenes: [],      // toutes ses scènes
  fiches: [],      // ses fiches (personnages, PNJ, lieux, événements)
  sceneId: null,   // la scène affichée dans l'éditeur
};

// Nombre de mots (texte rédigé) de chaque scène, gardé en mémoire pour aller vite
const mots = new Map();

// Charge un roman et tout son contenu. Renvoie le roman, ou null s'il n'existe pas.
export async function chargerRoman(id) {
  const [roman, chapitres, scenes, fiches] = await Promise.all([
    db.lire("romans", id), db.lireDuRoman("chapitres", id), db.lireDuRoman("scenes", id), db.lireDuRoman("fiches", id),
  ]);
  if (!roman) return null;
  etat.roman = roman;
  etat.chapitres = chapitres;
  etat.scenes = scenes;
  etat.fiches = fiches;
  etat.sceneId = null;
  mots.clear();
  for (const s of scenes) mots.set(s.id, compterMots(s.texte));
  return roman;
}

export function fermerRoman() {
  etat.roman = null;
  etat.chapitres = [];
  etat.scenes = [];
  etat.fiches = [];
  etat.sceneId = null;
  mots.clear();
}

// Tri selon le champ « ordre »
export const parOrdre = (a, b) => a.ordre - b.ordre;

export function chapitresTries() {
  return [...etat.chapitres].sort(parOrdre);
}
export function scenesDe(chapitreId) {
  return etat.scenes.filter((s) => s.chapitreId === chapitreId).sort(parOrdre);
}
export function trouverScene(id) {
  return etat.scenes.find((s) => s.id === id) || null;
}
export function trouverChapitre(id) {
  return etat.chapitres.find((c) => c.id === id) || null;
}
// Toutes les scènes dans l'ordre de lecture (chapitre 1 scène 1, chapitre 1 scène 2…)
export function scenesDansLOrdre() {
  return chapitresTries().flatMap((c) => scenesDe(c.id));
}

// ---------- Fiches ----------

export function trouverFiche(id) {
  return etat.fiches.find((f) => f.id === id) || null;
}
// Les fiches d'une catégorie, triées : par ordre pour les événements, par nom pour les autres
export function fichesDe(categorie) {
  const liste = etat.fiches.filter((f) => f.categorie === categorie);
  if (categorie === "evenement") return liste.sort(parOrdre);
  return liste.sort((a, b) => (a.titre || "").localeCompare(b.titre || "", "fr", { sensitivity: "base" }));
}

// Avance ou recule un événement d'un cran dans la chronologie (sens -1 : plus tôt, +1 : plus tard).
// Utilisé par le panneau et par la frise. Renvoie false s'il est déjà au bout.
export async function deplacerEvenement(id, sens) {
  const liste = fichesDe("evenement");
  const i = liste.findIndex((f) => f.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= liste.length) return false;
  [liste[i], liste[j]] = [liste[j], liste[i]];
  liste.forEach((f, k) => { f.ordre = k; });
  await db.lot({ ecrire: { fiches: liste } });
  return true;
}

// ---------- Fiches épinglées (deux au plus : par exemple, deux personnages principaux) ----------
// Elles sont notées dans le roman : ficheEpinglee (la première) et ficheEpinglee2 (la deuxième).

export const MAX_EPINGLEES = 2;

// Les fiches épinglées qui existent encore, dans l'ordre
export function fichesEpinglees() {
  if (!etat.roman) return [];
  const ids = [etat.roman.ficheEpinglee, etat.roman.ficheEpinglee2];
  return ids.filter((id, i) => id && ids.indexOf(id) === i).map(trouverFiche).filter(Boolean);
}
export function estEpinglee(id) {
  return !!id && fichesEpinglees().some((f) => f.id === id);
}
// Note les fiches épinglées (une liste d'identifiants, deux au plus) dans le roman
export function noterEpinglees(ids) {
  etat.roman.ficheEpinglee = ids[0] || null;
  etat.roman.ficheEpinglee2 = ids[1] || null;
}

// Les événements où apparaît une fiche (personnage ou lieu), dans l'ordre
export function evenementsDe(ficheId) {
  return fichesDe("evenement").filter((e) =>
    (e.champs?.personnages || []).includes(ficheId) || (e.champs?.lieux || []).includes(ficheId));
}

// ---------- Compteurs de mots ----------

export function recompterScene(id) {
  const s = trouverScene(id);
  if (s) mots.set(id, compterMots(s.texte));
}
export function oublierScene(id) {
  mots.delete(id);
}
export function motsScene(id) {
  return mots.get(id) || 0;
}
export function motsChapitre(chapitreId) {
  return scenesDe(chapitreId).reduce((t, s) => t + motsScene(s.id), 0);
}
export function motsRoman() {
  let total = 0;
  for (const n of mots.values()) total += n;
  return total;
}

// ---------- Petit système d'annonces entre les parties de l'application ----------
// ex. le plan annonce « ouvrir-scene », l'éditeur l'écoute et affiche la scène.

const auditeurs = {};
export function ecouter(nom, fonction) {
  (auditeurs[nom] ||= []).push(fonction);
}
export async function annoncer(nom, detail) {
  for (const f of auditeurs[nom] || []) await f(detail);
}
