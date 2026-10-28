// =====================================================================
// FICHES REPÉRÉES DANS LE TEXTE
// Pendant l'écriture, le panneau montre les personnages et les lieux des fiches
// qui sont nommés dans la scène ouverte (notes et texte rédigé), dans l'ordre où
// ils apparaissent. Un clic (ou un toucher) ouvre la fiche ; le curseur reste dans le texte.
//
// Une fiche est repérée par :
//   - son nom complet (« Mère Corbeau », « mère corbeau » : majuscules et accents ignorés) ;
//   - l'un de ses « Autres noms » (surnoms, séparés par des virgules) ;
//   - un mot de son nom écrit avec une majuscule (« Corbeau »), sauf les mots courants
//     comme « Mère », « Taverne » ou « Grand », que plusieurs fiches pourraient partager.
// Un nom d'un seul mot doit commencer par une majuscule dans le texte :
// « Corbeau » repère Mère Corbeau, « un corbeau » non.
// =====================================================================

import { el, ecrireTexte } from "./outils.js";
import { masquerSauts } from "../commun/saut-de-page.js";
import { etat, ecouter } from "./etat.js";
import { CATEGORIES, ouvrirFiche } from "./panneau.js";

const CATEGORIES_REPEREES = ["principal", "pnj", "lieu"];
const DELAI = 500; // on relit le texte un instant après la dernière touche, pas à chaque touche
const SEPARATEURS = /[^\p{L}\p{N}]+/u; // ce qui sépare deux mots

// Mots qui ne suffisent pas à repérer une fiche (sans accents, en minuscules)
const MOTS_COMMUNS = new Set(`
  les des aux une sur sous dans pour par avec sans chez entre vers the
  mon ton son mes tes ses nos vos notre votre leur leurs cet cette ces tout toute tous toutes
  elle elles ils nous vous lui eux qui que quoi dont nom oui non
  mere pere frere soeur sœur oncle tante cousin cousine fils fille veuve dame sire sieur messire seigneur
  maitre maitresse docteur doc professeur capitaine commandant lieutenant sergent caporal colonel general
  amiral major agent inspecteur inspectrice commissaire detective juge roi reine prince princesse duc duchesse
  comte comtesse baron baronne marquis marquise chevalier lord lady sir saint sainte monsieur madame mademoiselle
  don dona dom pretre pretresse abbe eveque mage sorcier sorciere chef patron patronne
  ville cite rue place avenue boulevard quartier tour tours chateau palais temple eglise cathedrale chapelle
  taverne auberge bar club port station base vaisseau planete lune mont montagne montagnes lac foret bois
  riviere fleuve ile desert plaine vallee village hameau royaume empire republique maison manoir hotel hopital
  ecole academie universite prison marche pont porte jardin parc cimetiere mine mines grotte caverne
  bibliotheque musee bureau tribunal commissariat secteur zone niveau etage salle entrepot usine laboratoire
  grand grande petit petite vieux vieil vieille nouveau nouvel nouvelle ancien ancienne haut haute bas basse
  noir noire blanc blanche rouge bleu bleue vert verte gris grise dore doree sombre sacre sacree
`.trim().split(/\s+/));

let minuterie = null;
let dernierAffichage = "";       // pour ne pas redessiner quand rien n'a changé
const memoire = new Map();       // motifs déjà préparés : fiche.id → { cle, motifs }

const $ = (id) => document.getElementById(id);

export function initialiserReperage() {
  for (const id of ["texte-notes", "texte-redige"]) $(id).addEventListener("input", () => planifier(DELAI));
  // (juste après l'affichage de la scène, pour ne pas le retarder)
  ecouter("scene-affichee", () => { planifier(30); lireEnAvance(); });
  ecouter("fiches-changees", () => { planifier(30); lireEnAvance(); });

  const zone = $("reperees");
  // Un clic sur une pastille ne « vole » pas le curseur au texte
  zone.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  zone.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fiche]");
    if (!b) return;
    // Au clavier (la pastille a le focus), on suit la fiche ; à la souris ou au doigt, on reste dans le texte
    ouvrirFiche(b.dataset.fiche, { focus: document.activeElement === b });
  });
}

function planifier(delai) {
  clearTimeout(minuterie);
  minuterie = setTimeout(majReperage, delai);
}

// Met à jour la liste « Dans cette scène » (et le nombre sur le bouton « Fiches »).
// Mêmes règles que les noms en couleur : le plus long nom l'emporte (« la Taverne du Corbeau Noir »
// ne nomme pas Mère Corbeau). Cela se passe pendant que l'on écrit : on ne retire donc rien de la page
// (Chrome couperait sinon l'annulation Ctrl+Z) ; les pastilles sont réutilisées, celles en trop cachées.
export function majReperage() {
  clearTimeout(minuterie);
  const zone = $("reperees");
  const fiches = etat.roman ? etat.fiches.filter(estReperable) : [];
  const scene = etat.sceneId && etat.scenes.find((s) => s.id === etat.sceneId);
  if (!scene || !fiches.length) {
    zone.hidden = true;
    dernierAffichage = "";
    majBouton(0);
    return;
  }
  const trouvees = fichesDeLaScene(scene, { notes: $("texte-notes").value, texte: $("texte-redige").value });
  majBouton(trouvees.length);
  const affichage = trouvees.map((f) => f.id + "\u0001" + f.titre + "\u0001" + f.type).join("\u0002") || "aucune";
  if (!zone.hidden && affichage === dernierAffichage) return;
  dernierAffichage = affichage;
  zone.hidden = false;
  // (le titre « Dans cette scène » et la case « Noms en couleur dans le texte » restent : seule la liste change)
  const liste = $("reperees-liste");
  if (!liste.firstChild) {
    liste.append(el("div", { class: "pastilles" }), el("p", { class: "discret petit" }, "Aucun personnage ni lieu de vos fiches n'est nommé ici."));
  }
  const [pastilles, aucune] = liste.children;
  aucune.hidden = trouvees.length > 0;
  pastilles.hidden = !trouvees.length;
  trouvees.forEach((f, i) => {
    let b = pastilles.children[i];
    if (!b) b = pastilles.appendChild(el("button", { type: "button", class: "pastille" }));
    b.hidden = false;
    b.dataset.fiche = f.id;
    const titre = CATEGORIES[f.categorie].nom + (f.type ? " · " + f.type : "");
    if (b.title !== titre) b.title = titre;
    ecrireTexte(b, f.titre);
  });
  // (pastilles en trop : cachées pendant que l'on écrit, retirées sinon)
  const ecrit = !!document.activeElement && document.activeElement.classList.contains("texte");
  for (let i = pastilles.children.length - 1; i >= trouvees.length; i--) {
    if (ecrit) pastilles.children[i].hidden = true; else pastilles.children[i].remove();
  }
}

// Les fiches nommées dans une scène, dans l'ordre de leur première apparition (notes, puis texte rédigé)
function fichesDeLaScene(scene, textes) {
  const decalage = (textes.notes || "").length + 1;
  return [...passagesDeLaScene(scene, textes)]
    .map(([id, p]) => ({ fiche: etat.fiches.find((f) => f.id === id), position: p.notes.length ? p.notes[0].debut : decalage + p.redige[0].debut }))
    .filter((x) => x.fiche)
    .sort((a, b) => a.position - b.position)
    .map((x) => x.fiche);
}

// Le bouton « Fiches » (écrans moyens et petits) indique combien de fiches sont nommées
function majBouton(nombre) {
  const b = $("bouton-fiches");
  ecrireTexte(b, nombre ? `Fiches (${nombre})` : "Fiches");
  b.setAttribute("aria-label", nombre ? `Fiches : ${nombre} nommée${nombre > 1 ? "s" : ""} dans cette scène` : "Fiches");
}

// Une fiche sans vrai nom (« Nouveau PNJ », pas encore renommée) n'est pas cherchée
export function estReperable(f) {
  return CATEGORIES_REPEREES.includes(f.categorie) && (f.titre || "").trim() !== ""
    && f.titre.trim() !== CATEGORIES[f.categorie].nouveau;
}

// =====================================================================
// La recherche des noms (sans affichage : utilisable et testable seule)
// =====================================================================

// Les fiches nommées dans le texte, dans l'ordre de leur première apparition
export function fichesNommees(texte, fiches) {
  const t = sansAccents(texte);
  const mots = new Set(t.toLowerCase().split(SEPARATEURS)); // les mots du texte, pour écarter vite les noms absents
  return fiches
    .map((fiche) => ({ fiche, position: premierePosition(t, mots, motifsDe(fiche)) }))
    .filter((x) => x.position >= 0)
    .sort((a, b) => a.position - b.position)
    .map((x) => x.fiche);
}

// Les noms qui repèrent une fiche
export function nomsDe(fiche) {
  const titre = propre(fiche.titre);
  const autres = (fiche.champs?.autresNoms || "").split(/[,;\n]/).map(propre).filter(Boolean);
  const noms = new Set([titre, ...autres].filter(Boolean));
  // Les mots du nom (« Corbeau » pour « Mère Corbeau », « Archiviste » pour « L'Archiviste »),
  // sauf les mots courants
  if (/[\s']/.test(titre)) {
    for (const mot of titre.split(/[\s']+/)) {
      const simple = sansAccents(mot).toLowerCase();
      if (/^\p{Lu}/u.test(mot) && simple.length >= 3 && !MOTS_COMMUNS.has(simple)) noms.add(mot);
    }
  }
  return [...noms];
}

function motifsDe(fiche) {
  const cle = fiche.titre + "\n" + (fiche.champs?.autresNoms || "");
  const deja = memoire.get(fiche.id);
  if (deja && deja.cle === cle) return deja.motifs;
  // Pour chaque nom : son motif, et son mot le plus long (s'il manque au texte, inutile de chercher)
  const motifs = nomsDe(fiche).map((nom) => ({
    re: motif(nom),
    indice: sansAccents(nom).toLowerCase().split(SEPARATEURS).reduce((a, b) => (b.length > a.length ? b : a), ""),
  }));
  memoire.set(fiche.id, { cle, motifs });
  return motifs;
}

function premierePosition(texte, mots, motifs) {
  let premiere = -1;
  for (const m of motifs) {
    if (m.indice && !mots.has(m.indice)) continue;
    const position = motEntier(texte, m.re);
    if (position >= 0 && (premiere < 0 || position < premiere)) premiere = position;
  }
  return premiere;
}

// Première apparition en mot entier (« Elara » ne compte pas dans « Elaran »)
const LETTRE = /[\p{L}\p{N}]/u;
function motEntier(texte, re) {
  re.lastIndex = 0;
  for (let r; (r = re.exec(texte));) {
    if (entier(texte, r.index, r.index + r[0].length)) return r.index;
    re.lastIndex = r.index + 1;
  }
  return -1;
}
const entier = (texte, debut, fin) =>
  !(debut > 0 && LETTRE.test(texte[debut - 1])) && !(fin < texte.length && LETTRE.test(texte[fin]));

// =====================================================================
// Toutes les apparitions des noms, à leur place exacte (pour les colorer dans le texte)
// =====================================================================

// Les noms à chercher pour ces fiches : [{ fiche, re, indice }]
export function preparerNoms(fiches) {
  return fiches.flatMap((fiche) => motifsDe(fiche).map((m) => ({ fiche, ...m })));
}

// Seulement les noms qui peuvent apparaître dans ce texte (tri rapide par les mots du texte)
export function nomsPossibles(texte, noms) {
  const mots = new Set(sansAccents(texte).toLowerCase().split(SEPARATEURS));
  return noms.filter((n) => !n.indice || mots.has(n.indice));
}

// Les noms trouvés dans un texte, à leur position exacte : [{ debut, fin, fiches }], dans l'ordre.
// Deux noms ne se chevauchent jamais : le plus long l'emporte (« Mère Corbeau » plutôt que « Corbeau ») ;
// un même passage qui nomme deux fiches les garde toutes les deux.
// Un nom coupé par un retour à la ligne (« Mère », puis « Corbeau » au début de la ligne suivante)
// n'est pas pris en entier : ses mots restent repérables chacun de son côté (ici « Corbeau »).
// (Il compte bien, lui, dans « Dans cette scène » : voir fichesNommees ;
// et avec « coupes : true », qui sert à la liste des scènes d'une fiche.)
export function nomsDansLeTexte(texte, noms, { coupes = false } = {}) {
  if (!texte) return [];
  // (les sauts de page sont masqués : un personnage nommé « Page » n'y est jamais repéré)
  const { t, origine } = normaliser(masquerSauts(texte));
  const trouves = [];
  for (const n of nomsPossibles(t, noms)) {
    n.re.lastIndex = 0;
    for (let r; (r = n.re.exec(t));) {
      const debut = r.index, fin = r.index + r[0].length;
      if (entier(t, debut, fin) && (coupes || !r[0].includes("\n"))) trouves.push({ debut, fin, fiche: n.fiche });
      n.re.lastIndex = debut + 1;
    }
  }
  // Les noms qui se chevauchent forment de petits groupes : on départage chaque groupe à part
  trouves.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
  const gardes = [];
  for (let i = 0; i < trouves.length;) {
    let j = i + 1, finGroupe = trouves[i].fin;
    while (j < trouves.length && trouves[j].debut < finGroupe) finGroupe = Math.max(finGroupe, trouves[j++].fin);
    gardes.push(...departager(trouves.slice(i, j)));
    i = j;
  }
  return origine ? gardes.map((g) => ({ ...g, debut: origine[g.debut], fin: origine[g.fin] })) : gardes;
}

// Dans un groupe de noms qui se chevauchent : le plus long d'abord, puis ceux qui ne le touchent pas
function departager(groupe) {
  if (groupe.length === 1) return [{ debut: groupe[0].debut, fin: groupe[0].fin, fiches: [groupe[0].fiche] }];
  groupe.sort((a, b) => (b.fin - b.debut) - (a.fin - a.debut) || a.debut - b.debut);
  const gardes = [];
  for (const x of groupe) {
    const meme = gardes.find((g) => g.debut === x.debut && g.fin === x.fin);
    if (meme) { if (!meme.fiches.includes(x.fiche)) meme.fiches.push(x.fiche); continue; }
    if (gardes.some((g) => x.debut < g.fin && g.debut < x.fin)) continue;
    gardes.push({ debut: x.debut, fin: x.fin, fiches: [x.fiche] });
  }
  return gardes.sort((a, b) => a.debut - b.debut);
}

// Ce qui distingue les noms de ces fiches : s'il change, il faut chercher de nouveau
export function signatureDesNoms(fiches) {
  return fiches.map((f) => [f.id, f.categorie, f.titre, f.champs?.autresNoms || ""].join("\u0001")).join("\u0002");
}

// =====================================================================
// Les scènes où chaque fiche est nommée (sur une fiche : « Nommé dans ces scènes »)
// Chaque scène n'est lue qu'une fois, puis de nouveau seulement si son texte change
// (ou si le nom d'une fiche change).
// =====================================================================

let lecture = { roman: null, signature: null, noms: [] };
const lues = new Map(); // scène.id → { notes, texte, fiches : Map(fiche.id → { redige: [{ debut, fin }], notes: [...] }) }

function nomsDuRoman() {
  const fiches = etat.roman ? etat.fiches.filter(estReperable) : [];
  const signature = signatureDesNoms(fiches);
  if (lecture.roman !== etat.roman?.id || lecture.signature !== signature) {
    lecture = { roman: etat.roman?.id, signature, noms: preparerNoms(fiches) };
    lues.clear();
  }
  return lecture.noms;
}

// Les scènes sont lues à l'avance, par petits morceaux, quand le navigateur n'a rien d'autre à faire :
// ainsi la première fiche ouverte n'attend pas (tout un gros roman d'un coup : une demi-seconde).
let lectureEnCours = false;
let enAttente = []; // ce qui attend que tout le roman soit lu (voir quandToutEstLu)
function lireEnAvance() {
  if (lectureEnCours) return;
  lectureEnCours = true;
  // (navigateurs sans « requestIdleCallback », comme Safari : des morceaux de 8 millisecondes,
  // entre lesquels le navigateur répond au clavier et au toucher)
  const plusTard = window.requestIdleCallback
    || ((f) => setTimeout(() => { const fin = performance.now() + 8; f({ timeRemaining: () => fin - performance.now() }); }, 1));
  const morceau = (temps) => {
    nomsDuRoman(); // (des noms ont changé depuis : tout est à relire)
    for (const s of etat.roman ? etat.scenes : []) {
      // (la scène ouverte est lue au besoin, avec le texte qui est à l'écran)
      if (s.id === etat.sceneId || dejaLue(s)) continue;
      if (temps.timeRemaining() < 4) { plusTard(morceau); return; }
      passagesDeLaScene(s);
    }
    lectureEnCours = false;
    const attendaient = enAttente;
    enAttente = [];
    for (const f of attendaient) f();
  };
  plusTard(morceau);
}
function dejaLue(s) {
  const deja = lues.get(s.id);
  return !!deja && deja.notes === (s.notes || "") && deja.texte === (s.texte || "");
}

// Toutes les scènes sont-elles lues ? S'il en reste peu (par exemple la scène que l'on vient de quitter),
// elles sont lues tout de suite. S'il en reste beaucoup (juste après l'ouverture d'un gros roman,
// ou un nom de fiche changé), non : la lecture à l'avance s'en charge, sans figer l'écran.
const A_LIRE_TOUT_DE_SUITE = 60000; // en caractères (environ 10 000 mots : quelques dizaines de millisecondes)
export function toutEstLu() {
  nomsDuRoman();
  if (!etat.roman) return true;
  const aLire = etat.scenes.filter((s) => s.id !== etat.sceneId && !dejaLue(s));
  const taille = aLire.reduce((t, s) => t + (s.texte || "").length + (s.notes || "").length, 0);
  if (taille > A_LIRE_TOUT_DE_SUITE) return false;
  for (const s of aLire) passagesDeLaScene(s);
  return true;
}
// Fait quelque chose dès que tout le roman est lu (la lecture se fait à l'avance, par petits morceaux)
export function quandToutEstLu(f) {
  enAttente.push(f);
  lireEnAvance();
}
// Les passages d'une scène où chaque fiche est nommée, dans le texte rédigé et dans les notes.
// « textes » : pour la scène ouverte, le texte des zones d'écriture (plus récent que celui enregistré).
// (Le plus long nom l'emporte, comme pour les noms en couleur : « Mère Corbeau » ne nomme pas la
// Taverne du Corbeau Noir ; « Corbeau » tout seul nomme les deux.)
export function passagesDeLaScene(scene, textes = scene) {
  const noms = nomsDuRoman();
  const notes = textes.notes || "", texte = textes.texte || "";
  const deja = lues.get(scene.id);
  if (deja && deja.notes === notes && deja.texte === texte) return deja.fiches;
  const fiches = new Map();
  for (const [mode, contenu] of [["redige", texte], ["notes", notes]]) {
    for (const n of nomsDansLeTexte(contenu, noms, { coupes: true })) {
      for (const f of n.fiches) {
        if (!fiches.has(f.id)) fiches.set(f.id, { redige: [], notes: [] });
        fiches.get(f.id)[mode].push({ debut: n.debut, fin: n.fin });
      }
    }
  }
  lues.set(scene.id, { notes, texte, fiches });
  return fiches;
}

// Le texte sans accents, et pour chacun de ses caractères, sa position dans le texte d'origine.
// (Presque toujours une lettre pour une lettre : alors les positions sont les mêmes.
// Sinon, par exemple un accent tapé à part « e + ´ », on refait le compte lettre par lettre.)
function normaliser(texte) {
  const t = sansAccents(texte);
  if (t.length === texte.length) return { t, origine: null };
  const morceaux = [], origine = [];
  for (let i = 0; i < texte.length; i++) {
    const n = sansAccents(texte[i]);
    morceaux.push(n);
    for (let k = 0; k < n.length; k++) origine.push(i);
  }
  origine.push(texte.length);
  return { t: morceaux.join(""), origine };
}

// Un nom → un motif de recherche : majuscules indifférentes,
// sauf la première lettre d'un nom d'un seul mot (qui doit être une majuscule).
// (Motif volontairement simple : il y en a plusieurs par fiche, il doit se préparer vite.)
function motif(nom) {
  const mots = sansAccents(nom).split(/\s+/);
  const seul = mots.length === 1;
  const corps = mots
    .map((mot) => [...mot].map((c, i) => (seul && i === 0 ? majuscule(c) : insensible(c))).join(""))
    .join("\\s+");
  return new RegExp(corps, "g");
}

function insensible(c) {
  const bas = c.toLowerCase(), haut = c.toUpperCase();
  return bas !== haut && bas.length === 1 && haut.length === 1 ? `[${bas}${haut}]` : echapper(c);
}

function majuscule(c) {
  const haut = c.toUpperCase();
  return haut.length === 1 ? echapper(haut) : echapper(c);
}

function echapper(c) {
  return c.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

// Sans accents (é → e), apostrophes unifiées
function sansAccents(t) {
  return (t || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘ʼ]/g, "'");
}

function propre(t) {
  return (t || "").replace(/[’‘ʼ]/g, "'").replace(/\s+/g, " ").trim();
}
