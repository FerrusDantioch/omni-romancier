// =====================================================================
// RECHERCHE RAPIDE (Ctrl+K)
// On tape un nom → la fiche s'ouvre dans le panneau → le curseur reste
// exactement où il était dans le texte. Échap ferme et ramène au texte.
//
// Le principe : juste avant d'ouvrir la fenêtre, on note où était le
// curseur (position, sélection, défilement). À la fermeture, quoi qu'il
// arrive, on remet tout à l'identique.
// =====================================================================

import { el } from "./outils.js";
import { etat, trouverFiche, estEpinglee } from "./etat.js";
import { CATEGORIES, ouvrirFiche, creerFiche, basculerVolet } from "./panneau.js";
import { revenirAuTexte, quitterConcentration } from "./editeur.js";

const MAX_RESULTATS = 8;
// Ordre d'affichage des catégories, à score égal
const ORDRE_CATEGORIES = ["principal", "pnj", "lieu", "evenement"];
// Catégories proposées à la création quand le nom n'existe pas encore
const CREATIONS = [["pnj", "Créer un PNJ"], ["lieu", "Créer un lieu"]];

let dialogue, saisie, liste;
let resultats = [];       // ce qui est affiché
let choix = 0;            // ligne sélectionnée
let memo = null;          // où était le curseur avant l'ouverture
const recentes = new Map(); // romanId → fiches choisies récemment

const $ = (id) => document.getElementById(id);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserRecherche() {
  dialogue = $("recherche");
  saisie = $("recherche-saisie");
  liste = $("recherche-resultats");

  // Ctrl+K (ou Cmd+K sur Mac) dans la page d'écriture
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "k") return;
    if ($("vue-roman").hidden) return;
    e.preventDefault();               // empêche aussi le navigateur d'utiliser Ctrl+K
    if (e.repeat) return;             // touche maintenue enfoncée : on n'ouvre/ferme pas en boucle (clignotement)
    if (dialogue.open) fermer();      // Ctrl+K une seconde fois : on referme
    else if (!document.querySelector("dialog[open]")) ouvrir();
  }, true); // « true » : on passe avant les autres raccourcis

  saisie.addEventListener("input", () => { choix = 0; chercher(); });
  saisie.addEventListener("keydown", surTouche);

  // Échap (le navigateur envoie « cancel ») : on ferme proprement
  dialogue.addEventListener("cancel", (e) => { e.preventDefault(); fermer(); });
  // Filet de sécurité : si la fenêtre se ferme par un autre chemin, le curseur retourne à sa place
  dialogue.addEventListener("close", () => { restaurer(memo); memo = null; });
  // Un clic à côté de la fenêtre la ferme
  // (preventDefault : sinon le navigateur retirerait le clavier du texte juste après)
  dialogue.addEventListener("mousedown", (e) => { if (e.target === dialogue) { e.preventDefault(); fermer(); } });

  // Souris : survol = sélection, clic = ouvrir
  liste.addEventListener("mousemove", (e) => {
    const li = e.target.closest("[data-index]");
    if (li && Number(li.dataset.index) !== choix) { choix = Number(li.dataset.index); marquerChoix(); }
  });
  liste.addEventListener("mousedown", (e) => e.preventDefault()); // garde le clavier dans la saisie
  liste.addEventListener("click", (e) => {
    const li = e.target.closest("[data-index]");
    if (li) choisir(Number(li.dataset.index), { modifier: e.ctrlKey || e.metaKey });
  });

  $("bouton-recherche").addEventListener("click", ouvrir);
  $("bouton-recherche-outils").addEventListener("click", ouvrir);
}

// =====================================================================
// Ouvrir / fermer
// =====================================================================

export function ouvrir() {
  if (!etat.roman || dialogue.open) return;
  memo = memoriser();
  saisie.value = "";
  choix = 0;
  chercher();
  dialogue.showModal();
  saisie.focus();
}

// Ferme la recherche sans rien choisir (ex. quand on quitte la page d'écriture)
export function fermerRecherche() {
  if (dialogue && dialogue.open) { memo = null; dialogue.close(); }
}

// Ferme la fenêtre et remet le curseur IMMÉDIATEMENT à sa place.
// (Attendre l'événement « close » du navigateur laisserait un court instant
// pendant lequel une lettre tapée très vite arriverait au mauvais endroit.)
function fermer() {
  if (!dialogue.open) return;
  dialogue.close();
  restaurer(memo);
  memo = null;
}

// Note précisément où est le curseur
function memoriser() {
  const actif = document.activeElement;
  const estChamp = actif && (actif.tagName === "TEXTAREA" || (actif.tagName === "INPUT" && actif.type === "text"));
  if (!estChamp) return { element: null };
  return {
    element: actif,
    debut: actif.selectionStart,
    fin: actif.selectionEnd,
    sens: actif.selectionDirection,
    defilement: actif.scrollTop,
  };
}

// Remet le curseur exactement où il était
function restaurer(m) {
  if (!m) return;
  const champ = m.element;
  // Le champ existe-t-il toujours, et est-il visible ? (une fiche peut avoir été remplacée)
  if (champ && champ.isConnected && champ.getClientRects().length > 0) {
    champ.focus({ preventScroll: true });
    champ.setSelectionRange(m.debut, m.fin, m.sens || "none");
    champ.scrollTop = m.defilement;
  } else {
    revenirAuTexte();
  }
}

// =====================================================================
// Recherche
// =====================================================================

// « Mère » → « mere » : sans accents ni majuscules
function normaliser(texte) {
  return (texte || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Note de pertinence d'un mot cherché dans une fiche (0 = absent)
function noteMot(mot, f) {
  const titre = f._titre;
  if (titre.startsWith(mot)) return 100;                       // le nom commence par…
  if (titre.split(/[\s'’-]+/).some((m) => m.startsWith(mot))) return 80; // un mot du nom commence par…
  if (f._autres.split(/[\s,;'’-]+/).some((m) => m.startsWith(mot))) return 70; // un surnom commence par…
  if (titre.includes(mot)) return 60;                          // le nom contient…
  if (f._type.includes(mot)) return 40;                        // le type contient…
  if (f._reste.includes(mot)) return 20;                       // le contenu de la fiche contient…
  return 0;
}

function chercher() {
  if (!etat.roman) return;
  const fiches = etat.fiches.map((f) => ({
    fiche: f,
    _titre: normaliser(f.titre),
    _autres: normaliser(f.champs?.autresNoms),
    _type: normaliser(f.type),
    _reste: normaliser([...Object.values(f.champs || {}).filter((v) => typeof v === "string"), f.notes].join(" ")),
  }));
  const requete = saisie.value.trim();
  const mots = normaliser(requete).split(/\s+/).filter(Boolean);

  if (mots.length === 0) {
    // Rien de tapé : les fiches choisies récemment, puis les autres
    const recents = (recentes.get(etat.roman.id) || []).map(trouverFiche).filter(Boolean);
    const autres = fiches.map((x) => x.fiche).filter((f) => !recents.includes(f)).sort(parCategorieEtNom);
    resultats = [...recents, ...autres].slice(0, MAX_RESULTATS).map((f) => ({ fiche: f }));
  } else {
    resultats = fiches
      .map((x) => {
        const notes = mots.map((m) => noteMot(m, x));
        return { fiche: x.fiche, note: notes.includes(0) ? 0 : notes.reduce((a, b) => a + b, 0) };
      })
      .filter((r) => r.note > 0)
      .sort((a, b) => b.note - a.note || parCategorieEtNom(a.fiche, b.fiche))
      .slice(0, MAX_RESULTATS);
    // Le nom tapé n'existe pas exactement : on propose de créer la fiche
    const existe = etat.fiches.some((f) => normaliser(f.titre) === normaliser(requete));
    if (!existe) {
      for (const [categorie, libelle] of CREATIONS) resultats.push({ creer: categorie, libelle, titre: requete });
    }
  }
  if (choix >= resultats.length) choix = 0;
  afficher(requete);
}

function parCategorieEtNom(a, b) {
  return ORDRE_CATEGORIES.indexOf(a.categorie) - ORDRE_CATEGORIES.indexOf(b.categorie)
    || (a.titre || "").localeCompare(b.titre || "", "fr", { sensitivity: "base" });
}

// =====================================================================
// Affichage des résultats
// =====================================================================

function afficher(requete) {
  liste.replaceChildren();
  if (resultats.length === 0) {
    liste.append(el("li", { class: "recherche-vide", role: "option", "aria-disabled": "true" },
      etat.fiches.length ? "Aucune fiche trouvée." : "Aucune fiche pour l'instant : tapez un nom pour en créer une."));
    saisie.removeAttribute("aria-activedescendant");
    return;
  }
  resultats.forEach((r, i) => {
    const id = "resultat-" + i;
    if (r.creer) {
      liste.append(el("li", { id, role: "option", class: "resultat resultat-creer", "data-index": i },
        el("span", { class: "resultat-categorie" }, "+ " + r.libelle),
        el("span", { class: "resultat-titre" }, "« " + r.titre + " »"),
      ));
      return;
    }
    const f = r.fiche;
    const detail = f.categorie === "evenement" ? f.champs?.quand : f.type;
    liste.append(el("li", { id, role: "option", class: "resultat", "data-index": i },
      el("span", { class: "resultat-categorie" }, CATEGORIES[f.categorie].nom),
      el("span", { class: "resultat-titre" }, surligner(f.titre || "Sans nom", requete)),
      detail ? el("span", { class: "resultat-detail" }, detail) : null,
      estEpinglee(f.id) ? el("span", { class: "resultat-epingle", title: "Épinglée" }, "📌") : null,
    ));
  });
  marquerChoix();
}

// Met en valeur la partie du nom qui correspond à ce qu'on a tapé
function surligner(titre, requete) {
  const mot = normaliser(requete.trim().split(/\s+/)[0] || "");
  const t = normaliser(titre);
  const i = mot ? t.indexOf(mot) : -1;
  if (i < 0 || t.length !== titre.length) return titre;
  return [titre.slice(0, i), el("mark", {}, titre.slice(i, i + mot.length)), titre.slice(i + mot.length)];
}

function marquerChoix() {
  liste.querySelectorAll("[data-index]").forEach((li) => {
    const actif = Number(li.dataset.index) === choix;
    li.setAttribute("aria-selected", String(actif));
    if (actif) {
      saisie.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  });
}

// =====================================================================
// Clavier dans la fenêtre de recherche
// =====================================================================

function surTouche(e) {
  if (e.isComposing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!resultats.length) return;
    const sens = e.key === "ArrowDown" ? 1 : -1;
    choix = (choix + sens + resultats.length) % resultats.length;
    marquerChoix();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (resultats.length) choisir(choix, { modifier: e.ctrlKey || e.metaKey });
  } else if (e.key === "Tab") {
    e.preventDefault(); // le clavier reste dans la recherche
  }
}

// =====================================================================
// Choisir un résultat
// =====================================================================

async function choisir(index, { modifier = false } = {}) {
  const r = resultats[index];
  if (!r || !etat.roman) return;
  const position = memo;   // copie : la fermeture efface « memo »
  if (modifier) memo = null; // en modification, le clavier ira dans la fiche, pas dans le texte
  fermer();

  // Pour voir la fiche, le panneau doit être visible
  quitterConcentration();
  if (getComputedStyle($("panneau")).position === "fixed") basculerVolet(true); // écran moyen ou petit : on ouvre le volet

  let fiche;
  if (r.creer) {
    fiche = await creerFiche(r.creer, { titre: r.titre, edition: modifier, focus: modifier });
  } else {
    fiche = r.fiche;
    ouvrirFiche(fiche.id, { edition: modifier, focus: modifier });
  }
  // Mémorise comme fiche récente
  const anciennes = (recentes.get(etat.roman.id) || []).filter((id) => id !== fiche.id);
  recentes.set(etat.roman.id, [fiche.id, ...anciennes].slice(0, 5));

  // En lecture, on reste dans le texte. Si quelque chose a déplacé le clavier entre-temps,
  // on le ramène ; sinon on ne touche à rien (on a peut-être déjà recommencé à taper).
  if (!modifier && position && document.activeElement !== position.element) restaurer(position);
}
