// =====================================================================
// RECHERCHER ET REMPLACER DANS TOUT LE ROMAN (Ctrl+F ; Ctrl+H pour remplacer)
// Une barre s'ouvre au-dessus du texte. On tape un mot : tous ses passages dans le roman
// (texte rédigé et notes de toutes les scènes) sont comptés, listés scène par scène,
// et surlignés dans le texte. Entrée (ou ↓) va au suivant, même dans une autre scène.
// « Remplacer » remplace le passage montré, puis va au suivant ; « Tout remplacer » remplace
// tout d'un coup, après confirmation. Un remplacement s'annule : bouton « Annuler le
// remplacement », ou Ctrl+Z dans le texte tant qu'on ne l'a pas retouché.
//
// Pendant la recherche, le clavier reste dans la barre. Or un texte qui n'a pas le clavier
// ne montre pas sa sélection : les passages trouvés sont donc dessinés sur un calque placé
// derrière le texte (même principe que les noms en couleur : voir surlignage.js).
// ATTENTION : pendant que l'on tape dans le texte, on ne retire rien de la page (Chrome couperait
// sinon l'annulation Ctrl+Z en petits morceaux). La liste et le calque attendent donc que l'on
// revienne dans la barre pour se mettre à jour : en attendant, ils sont seulement estompés ou cachés.
// =====================================================================

import { el, nombre, pluriel, ecrireTexte, STYLES_DU_TEXTE, placeDuTexte } from "./outils.js";
import { masquerSauts } from "../commun/saut-de-page.js";
import { confirmer, informer } from "./dialogues.js";
import { etat, ecouter, scenesDansLOrdre, trouverChapitre } from "./etat.js";
import {
  montrerPassage, textesActuels, positionDuCurseur, remplacerTextes, revenirAuTexte, quitterConcentration,
} from "./editeur.js";
import { basculerVolet } from "./panneau.js";

const CLE_OPTIONS = "atelier-recherche"; // les cases cochées, gardées sur cet appareil
const MAX_LISTE = 300;     // passages détaillés dans la liste (les suivants sont seulement comptés)
const DELAI = 150;         // on cherche un instant après la dernière touche (pas à chaque touche)
const MAX_HISTORIQUE = 10; // remplacements que l'on peut encore annuler, du plus récent au plus ancien
const CHAMP = { redige: "texte", notes: "notes" };
const MODES = [["redige", 0], ["notes", 1]]; // dans une scène : le texte rédigé d'abord, puis les notes
const APOSTROPHES = "'’‘ʼ";        // « l'épée » trouve aussi « l’épée »
const ESPACES = "   ";   // une espace trouve aussi une espace insécable
const LETTRE = /[\p{L}\p{N}\p{M}]/u;

const options = { majuscules: false, mot: false, redige: true, notes: true, liste: true };
let ouverte = false;
let motif = null;          // ce que l'on cherche (expression préparée) ; null = rien à chercher
let resultats = [];        // [{ scene, mode, debut, fin, trouve, source, rang }], dans l'ordre de lecture
let actuel = -1;           // le résultat courant
let revele = false;        // … a-t-il été montré dans le texte ?
let perime = false;        // on a écrit dans le texte depuis la dernière recherche
let dernierMessage = "";   // ce que vient de faire un remplacement (affiché jusqu'à la prochaine recherche)
let faits = [];            // les textes mis en place par « Remplacer », un par un : [{ sceneId, mode, debut, fin }]
                           // (« Ana » → « Anabelle » : le « Ana » de « Anabelle » n'est pas remplacé une 2e fois)
let minuterie = null;
let saisieEnAttente = false; // un mot tapé attend encore d'être cherché (voir aJour)
let ctrlZPossible = false; // Ctrl+Z dans le texte peut-il encore annuler le dernier remplacement ? (voir surCtrlZ)
let annulationEnCours = false;
let file = Promise.resolve(); // déplacements et remplacements se font l'un après l'autre
const historique = [];     // remplacements à annuler : [{ romanId, sceneOuverte, scenes: [{ id, avant, apres }] }]
const calques = {};        // pour chaque texte (notes, redige) : { zone, calque, interieur, styles }

const $ = (id) => document.getElementById(id);
// Sur Mac, Ctrl+F et Ctrl+H servent déjà dans le texte (avancer d'une lettre, effacer) : on y prend Cmd+F et Cmd+H
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserRemplacement() {
  try { Object.assign(options, JSON.parse(localStorage.getItem(CLE_OPTIONS)) || {}); } catch { /* options par défaut */ }
  for (const [id, cle] of [["br-majuscules", "majuscules"], ["br-mot", "mot"], ["br-redige", "redige"], ["br-notes", "notes"]]) {
    const caseACocher = $(id);
    caseACocher.checked = !!options[cle];
    caseACocher.addEventListener("change", () => {
      options[cle] = caseACocher.checked;
      retenirOptions();
      dernierMessage = "";
      faits = [];
      chercher({ depuisCurseur: true });
    });
  }

  for (const mode of ["notes", "redige"]) {
    const zone = $("texte-" + mode), calque = $("trouvailles-" + mode);
    const c = { zone, calque, interieur: calque.firstElementChild, styles: "" };
    calques[mode] = c;
    zone.addEventListener("input", () => {
      ctrlZPossible = false; // (on a retouché le texte : Ctrl+Z défait la frappe, pas le remplacement)
      if (ouverte) marquerPerime();
    });
    zone.addEventListener("scroll", () => suivreDefilement(c));
    zone.addEventListener("keydown", surCtrlZ);
    // (taille du texte changée : le calque suit, sans être refait)
    new ResizeObserver(() => { if (!calque.hidden) { copierStyles(c); suivreDefilement(c); } }).observe(zone);
  }

  document.addEventListener("keydown", surTouche);
  $("bouton-remplacer").addEventListener("click", () => ouvrir({ remplacer: true }));

  const saisie = $("br-chercher");
  saisie.addEventListener("input", () => {
    dernierMessage = "";
    faits = [];
    clearTimeout(minuterie);
    saisieEnAttente = true;
    minuterie = setTimeout(() => chercher({ depuisCurseur: true }), DELAI);
  });
  saisie.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    enOrdre(e.shiftKey ? precedent : suivant);
  });
  $("br-par").addEventListener("input", () => afficherListe()); // (l'aperçu du remplacement suit)
  $("br-par").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    enOrdre(remplacerUn);
  });
  $("br-precedent").addEventListener("click", () => enOrdre(precedent));
  $("br-suivant").addEventListener("click", () => enOrdre(suivant));
  $("br-remplacer").addEventListener("click", () => enOrdre(remplacerUn));
  $("br-tout").addEventListener("click", () => enOrdre(toutRemplacer));
  $("br-annuler").addEventListener("click", () => enOrdre(annuler));
  $("br-fermer").addEventListener("click", () => fermer());
  $("br-voir-options").addEventListener("click", () => {
    const ouvertes = $("barre-recherche").classList.toggle("options-ouvertes");
    $("br-voir-options").setAttribute("aria-expanded", String(ouvertes));
    majEtat();
  });
  $("br-voir-liste").addEventListener("click", () => {
    options.liste = !options.liste;
    retenirOptions();
    afficherListe();
  });
  $("br-resultats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    const cible = b && resultats[Number(b.dataset.i)]; // (retenu tout de suite : la liste peut être refaite entre-temps)
    if (cible) enOrdre(() => allerA(cible));
  });
  // On revient dans un champ de la barre après avoir écrit dans le texte : la recherche se met à jour.
  // (Pas en touchant un bouton : refaire la liste à ce moment-là déplacerait le bouton sous le doigt,
  // et le clic serait perdu. Chaque bouton remet lui-même la recherche à jour.)
  $("barre-recherche").addEventListener("focusin", (e) => { if (perime && e.target.matches("input[type=text]")) chercher(); });

  // Autre scène, plan changé, Notes ou Rédigé : la recherche suit
  ecouter("scene-affichee", (id) => {
    // (autre scène ouverte : Ctrl+Z redevient l'annulation habituelle, voir surCtrlZ)
    if (!derniereOperation() || derniereOperation().sceneOuverte !== id) ctrlZPossible = false;
    if (!ouverte) return;
    if (!id) fermer({ versLeTexte: false }); // (plus aucune scène : la barre n'a plus lieu d'être)
    else chercher();
  });
  ecouter("plan-change", () => { if (ouverte) chercher(); });
  ecouter("mode-affiche", () => { if (ouverte) dessinerCalques(); });
}

function retenirOptions() {
  try { localStorage.setItem(CLE_OPTIONS, JSON.stringify(options)); } catch { /* tant pis : le choix vaut pour cette fois */ }
}

// Les actions se suivent dans l'ordre (deux appuis rapides sur Entrée ne s'emmêlent pas)
function enOrdre(action) {
  file = file.then(action).catch((erreur) => {
    console.error(erreur);
    informer("La recherche a rencontré un problème : " + erreur.message, { erreur: true });
  });
  return file;
}

// Ctrl+F : rechercher ; Ctrl+H : remplacer ; Échap : fermer la barre
function surTouche(e) {
  if ($("vue-roman").hidden || document.querySelector("dialog[open]")) return;
  const touche = e.key.toLowerCase();
  const commande = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (commande && !e.altKey && !e.shiftKey && (touche === "f" || touche === "h")) {
    if ($("editeur-plein").hidden) return; // roman encore vide : la recherche du navigateur reste possible
    e.preventDefault();
    if (!e.repeat) ouvrir({ remplacer: touche === "h" });
  } else if (e.key === "Escape" && ouverte && !e.defaultPrevented // (Échap a déjà servi : concentration, volet…)
      && !document.body.classList.contains("concentration")
      && !$("vue-roman").classList.contains("plan-ouvert") && !$("vue-roman").classList.contains("panneau-ouvert")) {
    const ici = document.activeElement;
    if ($("barre-recherche").contains(ici)) { e.preventDefault(); fermer(); }               // retour au texte
    else if (ici && ici.classList.contains("texte")) { e.preventDefault(); fermer({ versLeTexte: false }); }
  }
}

// =====================================================================
// Ouvrir, fermer
// =====================================================================

// « remplacer » : le clavier va dans « Remplacer par » (si l'on sait déjà quoi chercher)
export function ouvrir({ remplacer = false } = {}) {
  if (!etat.roman || $("editeur-plein").hidden) return;
  quitterConcentration();
  $("vue-roman").classList.remove("plan-ouvert"); // (petit écran : on vient peut-être du plan)
  if ($("vue-roman").classList.contains("panneau-ouvert")) basculerVolet(false);
  const saisie = $("br-chercher");
  const choisi = texteChoisi();
  if (choisi) saisie.value = choisi;
  $("barre-recherche").hidden = false;
  ouverte = true;
  dernierMessage = "";
  faits = [];
  const champ = remplacer && saisie.value ? $("br-par") : saisie;
  champ.focus();
  champ.select();
  chercher({ depuisCurseur: true });
}

// Le mot sélectionné dans le texte devient ce que l'on cherche (court, et sur une seule ligne)
function texteChoisi() {
  const z = document.activeElement;
  if (!z || !z.classList.contains("texte")) return "";
  const t = z.value.slice(z.selectionStart, z.selectionEnd).trim();
  return t && t.length <= 100 && !t.includes("\n") ? t : "";
}

// Ferme la barre quand on quitte la page d'écriture (ou qu'on change de roman)
export function fermerRemplacement() {
  if (ouverte) fermer({ versLeTexte: false });
}

// « versLeTexte » : le clavier retourne dans le texte, sur le passage montré (sélectionné)
function fermer({ versLeTexte = true } = {}) {
  clearTimeout(minuterie);
  saisieEnAttente = false;
  ouverte = false;
  perime = false;
  faits = [];
  $("barre-recherche").hidden = true;
  for (const c of Object.values(calques)) cacherCalque(c);
  if (versLeTexte) revenirAuTexte();
}

// =====================================================================
// Chercher
// =====================================================================

// Ce que l'on cherche, et ce que l'on met à la place. Les espaces au début et à la fin ne comptent pas
// (le clavier d'un téléphone en ajoute souvent une après un mot), sauf s'il n'y a que des espaces.
const requete = () => { const q = $("br-chercher").value; return q.trim() || q; };
const remplacant = () => { const p = $("br-par").value; return p.trim() || p; };

// Majuscules indifférentes (sauf « Majuscules exactes ») ; les accents, eux, comptent toujours
// (« a » ne trouve pas « à »).
function preparerMotif(q) {
  if (!q || !(options.redige || options.notes)) return null;
  const corps = [...q].map((c) => {
    if (APOSTROPHES.includes(c)) return "['’‘ʼ]";
    if (ESPACES.includes(c)) return "[ \\u00A0\\u202F]";
    return c.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  }).join("");
  return new RegExp(corps, options.majuscules ? "gu" : "giu");
}

// Un passage en « mot entier » : ni lettre ni chiffre juste avant, ni juste après
const entier = (t, debut, fin) => !(debut > 0 && LETTRE.test(t[debut - 1])) && !(fin < t.length && LETTRE.test(t[fin]));

// Les passages trouvés dans un texte : [[debut, fin], …]
function passages(source) {
  const trouves = [];
  if (!source || !motif) return trouves;
  // On cherche dans le texte où les sauts de page sont masqués (mêmes positions) :
  // « Remplacer » ne peut jamais abîmer un saut de page.
  const texte = masquerSauts(source);
  motif.lastIndex = 0;
  for (let r; (r = motif.exec(texte));) {
    const debut = r.index, fin = debut + r[0].length;
    // (un accent écrit à part, « e » + « ´ » : le « e » seul n'est pas un passage de « e »)
    const coupe = fin < texte.length && /\p{M}/u.test(texte[fin]);
    if (!coupe && (!options.mot || entier(texte, debut, fin))) trouves.push([debut, fin]);
    else motif.lastIndex = debut + 1; // (pas un passage entier : on cherche un peu plus loin)
  }
  return trouves;
}

// Tous les passages du roman, dans l'ordre de lecture (pour la scène ouverte : le texte à l'écran)
function trouverTout() {
  const liste = [];
  scenesDansLOrdre().forEach((scene, n) => {
    const textes = textesActuels(scene.id);
    for (const [mode, k] of MODES) {
      if (!options[mode]) continue;
      const source = textes[CHAMP[mode]];
      for (const [debut, fin] of passages(source)) {
        liste.push({ scene, mode, debut, fin, trouve: source.slice(debut, fin), source, rang: n * 2 + k });
      }
    }
  });
  return liste;
}

// La place d'un texte dans l'ordre de lecture (pour trouver le passage qui suit le curseur)
function rangDe(sceneId, mode) {
  const n = scenesDansLOrdre().findIndex((s) => s.id === sceneId);
  return n < 0 ? -1 : n * 2 + (mode === "notes" ? 1 : 0);
}

// Le premier passage à partir d'un endroit (après le dernier : de nouveau le premier du roman)
function premierDepuis(rang, position) {
  const i = resultats.findIndex((r) => r.rang > rang || (r.rang === rang && r.debut >= position));
  return i < 0 ? 0 : i;
}

// Pareil, en sautant les textes mis en place par « Remplacer » (-1 : il ne reste qu'eux)
function prochainLibre(rang, position) {
  const libre = (r) => !faits.some((f) => f.sceneId === r.scene.id && f.mode === r.mode && r.debut < f.fin && r.fin > f.debut);
  const i = resultats.findIndex((r) => (r.rang > rang || (r.rang === rang && r.debut >= position)) && libre(r));
  return i >= 0 ? i : resultats.findIndex(libre);
}

// Refait la recherche. Le résultat courant reste le même s'il existe encore ;
// « depuisCurseur » : on repart du curseur dans le texte (nouveau mot cherché) ;
// « depuis » : on repart d'un endroit précis (juste après un passage remplacé), en sautant
// les textes que l'on vient de mettre en place (aucun passage restant : pas de résultat courant).
function chercher({ depuisCurseur = false, depuis = null } = {}) {
  clearTimeout(minuterie);
  saisieEnAttente = false;
  if (!ouverte || !etat.roman) return;
  // (on est en train d'écrire dans le texte : on attend le retour dans la barre, voir marquerPerime)
  if (perime && document.activeElement && document.activeElement.classList.contains("texte")) return;
  perime = false;
  motif = preparerMotif(requete());
  const avant = resultats[actuel];
  const avantRevele = revele;
  resultats = motif ? trouverTout() : [];
  actuel = -1;
  revele = false;
  if (resultats.length) {
    if (depuis) {
      actuel = prochainLibre(depuis.rang, depuis.position);
    } else if (!depuisCurseur && avant) {
      const meme = resultats.findIndex((r) => r.scene.id === avant.scene.id && r.mode === avant.mode && r.debut === avant.debut);
      if (meme >= 0) { actuel = meme; revele = avantRevele; }
      else actuel = premierDepuis(avant.rang, avant.debut);
    } else {
      const c = positionDuCurseur();
      actuel = c ? prochainLibre(rangDe(c.sceneId, c.mode), c.position) : prochainLibre(-1, 0);
    }
  }
  afficherTout();
  // En tapant le mot : le premier passage qui suit le curseur est montré, s'il est sur l'écran de la scène ouverte
  // (on n'ouvre pas une autre scène à chaque lettre tapée : Entrée ou ↓ y mènent).
  // Pas si le clavier est déjà retourné dans le texte : la lettre suivante remplacerait le passage sélectionné.
  const r = resultats[actuel];
  const dansLeTexte = document.activeElement && document.activeElement.classList.contains("texte");
  if (depuisCurseur && r && !dansLeTexte && r.scene.id === etat.sceneId && !calques[r.mode].zone.hidden) {
    revele = true;
    montrerPassage(r.scene.id, r.mode, r.debut, r.fin);
    marquerActuel();
  }
}

// =====================================================================
// Aller d'un passage à l'autre
// =====================================================================

// Avant d'agir, la recherche doit être à jour : un mot tapé il y a moins de 0,15 s n'a pas encore
// été cherché (Entrée juste après la dernière lettre), ou l'on a écrit dans le texte depuis.
function aJour() {
  if (saisieEnAttente) chercher({ depuisCurseur: true });
  else if (perime) chercher();
}

// Montre un passage : sa scène s'ouvre au besoin, il est sélectionné et surligné (le clavier reste dans la barre)
async function aller(i) {
  if (!ouverte) return;
  aJour();
  const n = resultats.length;
  if (!n) return;
  actuel = ((i % n) + n) % n;
  revele = true;
  const r = resultats[actuel];
  marquerActuel();
  await montrerPassage(r.scene.id, r.mode, r.debut, r.fin);
  // (une autre scène s'est ouverte : la recherche est refaite et le calque redessiné, voir « scene-affichee » ;
  // le résultat courant y est retrouvé, il reste le même)
  marquerActuel();
  if (calques[r.mode]) suivreDefilement(calques[r.mode]);
}

async function suivant() {
  aJour();
  if (!resultats.length) return;
  await aller(actuel < 0 ? 0 : revele ? actuel + 1 : actuel); // (pas encore montré : c'est lui, le suivant)
}

async function precedent() {
  aJour();
  if (resultats.length) await aller(actuel < 0 ? -1 : actuel - 1);
}

// Va à un passage touché dans la liste (retrouvé, si la recherche a été refaite entre-temps)
async function allerA(cible) {
  aJour();
  let i = resultats.indexOf(cible);
  if (i < 0) i = resultats.findIndex((r) => r.scene.id === cible.scene.id && r.mode === cible.mode && r.debut === cible.debut);
  if (i < 0) i = premierDepuis(cible.rang, cible.debut);
  await aller(i);
}

// =====================================================================
// Remplacer
// =====================================================================

// Le texte mis à la place d'un passage. Sans « Majuscules exactes », la majuscule du passage est gardée,
// comme dans un traitement de texte : « Épée » → « Lame » ; « ÉPÉE » → « LAME ».
function adapter(par, trouve) {
  if (options.majuscules || !par) return par;
  const lettres = trouve.replace(/[^\p{L}]/gu, "");
  const enCapitales = (t) => t === t.toLocaleUpperCase("fr") && t !== t.toLocaleLowerCase("fr");
  if (lettres.length >= 2 && enCapitales(lettres)) return par.toLocaleUpperCase("fr");
  if (lettres && enCapitales(lettres[0])) return par.replace(/\p{L}/u, (l) => l.toLocaleUpperCase("fr"));
  return par;
}

// Remplace le passage montré, puis montre le suivant.
// (Un passage pas encore montré est d'abord montré : on ne remplace que ce que l'on a vu.)
async function remplacerUn() {
  if (!ouverte) return;
  aJour();
  const r = resultats[actuel];
  if (!r) { if (resultats.length) await aller(0); return; }
  if (!revele || r.scene.id !== etat.sceneId) { await aller(actuel); return; }
  const champ = CHAMP[r.mode];
  const avant = textesActuels(r.scene.id);
  if (avant[champ].slice(r.debut, r.fin) !== r.trouve) { chercher(); return; } // (le texte a bougé : on recherche)
  const par = adapter(remplacant(), r.trouve);
  const apres = { ...avant, [champ]: avant[champ].slice(0, r.debut) + par + avant[champ].slice(r.fin) };
  if (!await appliquer([{ id: r.scene.id, avant, apres }])) return;
  // On retient le texte mis en place (et l'on décale ceux d'après, dans le même texte)
  const ecart = par.length - (r.fin - r.debut);
  faits = faits.map((f) => (f.sceneId === r.scene.id && f.mode === r.mode && f.debut >= r.fin ? { ...f, debut: f.debut + ecart, fin: f.fin + ecart } : f));
  faits.push({ sceneId: r.scene.id, mode: r.mode, debut: r.debut, fin: r.debut + par.length });
  dernierMessage = "1 passage remplacé.";
  // La suite : juste après le texte mis en place (lui n'est pas cherché de nouveau)
  chercher({ depuis: { rang: r.rang, position: r.debut + par.length } });
  if (actuel >= 0) await aller(actuel);
  else { dernierMessage = "1 passage remplacé. Il n'en reste plus à remplacer."; majEtat(); }
}

// Remplace tous les passages trouvés, après confirmation
async function toutRemplacer() {
  if (!ouverte) return;
  aJour();
  if (!resultats.length) return;
  const q = requete(), par = remplacant();
  const nombreScenes = new Set(resultats.map((r) => r.scene.id)).size;
  const combien = `${pluriel(resultats.length, "passage")}, dans ${pluriel(nombreScenes, "scène")}`;
  const ok = await confirmer({
    titre: par ? "Tout remplacer ?" : "Tout supprimer ?",
    message: [
      par ? `« ${q} » sera remplacé par « ${par} » : ${combien}.` : `« ${q} » sera supprimé : ${combien}.`,
      "Vous pourrez l'annuler juste après : bouton « Annuler le remplacement ».",
    ],
    ok: par ? "Tout remplacer" : "Tout supprimer",
    danger: !par,
  });
  if (!document.activeElement || document.activeElement === document.body) $("br-tout").focus({ preventScroll: true });
  if (!ok || !ouverte) return;
  chercher(); // (au cas où le texte aurait bougé pendant la question)
  const parScene = new Map();
  for (const r of resultats) {
    if (!parScene.has(r.scene.id)) parScene.set(r.scene.id, []);
    parScene.get(r.scene.id).push(r);
  }
  const misEnPlace = []; // (les textes mis en place : « Remplacer » ne les remplacera pas une seconde fois)
  const changements = [...parScene].map(([id, liste]) => {
    const avant = textesActuels(id), apres = { ...avant };
    for (const [mode] of MODES) {
      const ici = liste.filter((r) => r.mode === mode);
      if (!ici.length) continue;
      const t = avant[CHAMP[mode]], morceaux = [];
      let pos = 0, longueur = 0;
      for (const r of ici) {
        const entre = t.slice(pos, r.debut), nouveau = adapter(par, r.trouve);
        morceaux.push(entre, nouveau);
        longueur += entre.length;
        misEnPlace.push({ sceneId: id, mode, debut: longueur, fin: longueur + nouveau.length });
        longueur += nouveau.length;
        pos = r.fin;
      }
      morceaux.push(t.slice(pos));
      apres[CHAMP[mode]] = morceaux.join("");
    }
    return { id, avant, apres };
  });
  const total = resultats.length, scenes = parScene.size;
  if (!changements.length || !await appliquer(changements)) return;
  faits = misEnPlace;
  dernierMessage = `${pluriel(total, "passage remplacé", "passages remplacés")} dans ${pluriel(scenes, "scène")}.`;
  chercher({ depuisCurseur: true });
}

// Écrit les nouveaux textes (tout ou rien), et retient de quoi annuler
async function appliquer(changements) {
  if (!await ecrire(changements)) return false;
  historique.push({ romanId: etat.roman.id, sceneOuverte: etat.sceneId, scenes: changements });
  if (historique.length > MAX_HISTORIQUE) historique.shift();
  ctrlZPossible = true;
  return true;
}

async function ecrire(changements) {
  let reponse;
  try {
    reponse = await remplacerTextes(changements);
  } catch (erreur) {
    informer("Le remplacement n'a pas pu être enregistré : " + erreur.message + ". Rien n'a été changé.", { erreur: true });
    return false;
  }
  if (reponse === "attente") {
    informer("Du texte attend encore d'être enregistré : rien n'a été remplacé. Réessayez dans un instant ; "
      + "si cela dure, exportez vos données puis rechargez la page.", { erreur: true, duree: 8000 });
    return false;
  }
  if (reponse === "change") {
    informer("Le texte vient de changer : rien n'a été remplacé. Réessayez.", { erreur: true });
    chercher();
    return false;
  }
  return true;
}

// =====================================================================
// Annuler un remplacement
// =====================================================================

const pareil = (a, b) => !!a && a.notes === b.notes && a.texte === b.texte;

// Le dernier remplacement de ce roman (ceux d'un autre roman sont oubliés)
function derniereOperation() {
  const op = historique[historique.length - 1];
  if (op && (!etat.roman || op.romanId !== etat.roman.id)) { historique.length = 0; return null; }
  return op || null;
}

// Remet le texte d'avant le dernier remplacement. Une scène retouchée depuis n'est pas remise
// (on n'efface jamais ce que l'on a écrit après).
async function annuler() {
  const op = derniereOperation();
  if (!op) return;
  const changements = [];
  let retouchees = 0;
  for (const c of op.scenes) {
    if (pareil(textesActuels(c.id), c.apres)) changements.push({ id: c.id, avant: c.apres, apres: c.avant });
    else retouchees++;
  }
  if (changements.length && !await ecrire(changements)) return;
  historique.pop();
  faits = [];
  const message = changements.length
    ? "Remplacement annulé." + (retouchees ? ` (${pluriel(retouchees, "scène retouchée", "scènes retouchées")} depuis : laissée${retouchees > 1 ? "s" : ""} telle${retouchees > 1 ? "s" : ""} quelle${retouchees > 1 ? "s" : ""}.)` : "")
    : "Rien à annuler : le texte a été retouché depuis ce remplacement.";
  dernierMessage = message;
  if (ouverte) chercher();
  if (!ouverte || perime) informer(message); // (barre fermée, ou liste en attente : le message s'affiche en bas)
}

// Ctrl+Z dans le texte, juste après un remplacement : c'est le remplacement qui est annulé
// (puis le précédent, etc.). Seulement tant que l'on n'a ni écrit dans le texte, ni changé de scène :
// sinon Ctrl+Z redevient l'annulation habituelle de la frappe (et un remplacement ancien ne se
// défait pas par surprise). Le bouton « Annuler le remplacement », lui, reste possible.
function surCtrlZ(e) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.isComposing || e.key.toLowerCase() !== "z") return;
  if (annulationEnCours) { e.preventDefault(); return; } // (touche maintenue : une annulation à la fois)
  const op = derniereOperation();
  if (!ctrlZPossible || !op || op.sceneOuverte !== etat.sceneId) return;
  if (!op.scenes.some((c) => pareil(textesActuels(c.id), c.apres))) return;
  e.preventDefault();
  if (e.repeat) return;
  annulationEnCours = true;
  enOrdre(annuler).finally(() => { annulationEnCours = false; });
}

// =====================================================================
// Affichage : le compte, le message, la liste, le calque
// =====================================================================

function afficherTout() {
  $("br-resultats").classList.remove("perime");
  afficherListe();
  dessinerCalques();
  majEtat();
}

// Le compte (« 3 / 27 »), le message, l'état des boutons
function majEtat() {
  const n = resultats.length;
  ecrireTexte($("br-compte"), !motif ? "" : n ? `${actuel < 0 ? "–" : actuel + 1} / ${nombre(n)}` : "0");
  let message;
  if (perime) message = "Le texte a changé : la recherche se met à jour dès que vous revenez dans cette barre.";
  else if (dernierMessage) message = dernierMessage;
  else if (!options.redige && !options.notes) message = "Cochez « Texte rédigé » ou « Notes » : c'est là que l'on cherche.";
  else if (!motif) message = "Tapez un mot : il est cherché dans toutes les scènes du roman.";
  else if (!n) message = "Aucun passage trouvé.";
  else message = `${pluriel(n, "passage")} dans ${pluriel(new Set(resultats.map((r) => r.scene.id)).size, "scène")}.`;
  ecrireTexte($("br-message"), message);
  // (« Remplacer » se met en pause quand il ne reste que des textes que l'on vient de mettre en place ;
  // ↓ permet d'y aller quand même, et de les remplacer si on le veut vraiment)
  const enPause = actuel < 0 && faits.length > 0;
  for (const id of ["br-precedent", "br-suivant", "br-remplacer", "br-tout"]) {
    const inactif = !n || (id === "br-remplacer" && enPause);
    if ($(id).disabled !== inactif) $(id).disabled = inactif;
  }
  // (petit écran, options repliées : le bouton dit combien ne sont pas réglées comme d'habitude)
  const ouvertes = $("barre-recherche").classList.contains("options-ouvertes");
  const reglees = [options.majuscules, options.mot, !options.redige, !options.notes].filter(Boolean).length;
  ecrireTexte($("br-voir-options"), ouvertes ? "Moins d'options" : reglees ? `Options (${reglees})` : "Options");
  const annulable = !!derniereOperation();
  if ($("br-annuler").hidden === annulable) $("br-annuler").hidden = !annulable;
}

// La liste des passages, scène par scène, chacun avec un peu de texte autour
// (et, si « Remplacer par » est rempli, l'aperçu du remplacement)
function afficherListe() {
  const liste = $("br-resultats"), bouton = $("br-voir-liste");
  bouton.hidden = !resultats.length;
  ecrireTexte(bouton, options.liste ? "Masquer la liste" : "Afficher la liste");
  bouton.setAttribute("aria-expanded", String(options.liste));
  liste.hidden = !options.liste || !resultats.length;
  if (liste.hidden) { liste.replaceChildren(); return; }
  const par = $("br-par").value !== "" ? remplacant() : null;
  const parScene = new Map();
  for (const r of resultats) parScene.set(r.scene.id, (parScene.get(r.scene.id) || 0) + 1);
  const morceau = document.createDocumentFragment();
  let groupe = null, sceneId = null;
  resultats.slice(0, MAX_LISTE).forEach((r, i) => {
    if (r.scene.id !== sceneId) {
      sceneId = r.scene.id;
      groupe = el("ul", { class: "br-passages" });
      morceau.append(el("li", { class: "br-scene" },
        el("p", { class: "br-scene-titre" },
          el("span", { class: "br-chapitre" }, trouverChapitre(r.scene.chapitreId)?.titre || "Sans titre"),
          el("span", { class: "br-titre" }, r.scene.titre || "Sans titre"),
          el("span", { class: "br-nombre mono", title: "passages dans cette scène" }, nombre(parScene.get(sceneId))),
        ),
        groupe,
      ));
    }
    groupe.append(el("li", {}, ligneResultat(r, i, par)));
  });
  if (resultats.length > MAX_LISTE) {
    morceau.append(el("li", { class: "br-plus discret petit" },
      `… et ${pluriel(resultats.length - MAX_LISTE, "autre passage", "autres passages")}, comptés mais pas détaillés ici (↓ y mène aussi).`));
  }
  liste.replaceChildren(morceau);
  marquerActuel();
}

function ligneResultat(r, i, par) {
  const { avant, apres } = autour(r.source, r.debut, r.fin);
  return el("button", { type: "button", class: "br-resultat", "data-i": i },
    r.mode === "notes" ? el("span", { class: "br-ou", title: "Dans les notes de la scène" }, "notes") : null,
    el("span", { class: "br-extrait" },
      avant,
      par === null ? el("mark", {}, r.trouve) : [el("del", {}, r.trouve), el("ins", {}, adapter(par, r.trouve))],
      apres,
    ),
  );
}

// Un peu de texte de chaque côté d'un passage, sans sortir de son paragraphe ni couper un mot
function autour(texte, debut, fin) {
  const debutLigne = debut > 0 ? texte.lastIndexOf("\n", debut - 1) + 1 : 0;
  let finLigne = texte.indexOf("\n", fin);
  if (finLigne < 0) finLigne = texte.length;
  let a = Math.max(debutLigne, debut - 40), b = Math.min(finLigne, fin + 70);
  if (a > debutLigne) { const espace = texte.indexOf(" ", a); if (espace >= 0 && espace < debut) a = espace + 1; }
  if (b < finLigne) { const espace = texte.lastIndexOf(" ", b); if (espace > fin) b = espace; }
  return {
    avant: (a > debutLigne ? "…" : "") + texte.slice(a, debut),
    apres: texte.slice(fin, b) + (b < finLigne ? "…" : ""),
  };
}

// Le résultat courant ressort dans la liste et dans le texte (seulement des attributs changent)
function marquerActuel() {
  const liste = $("br-resultats");
  for (const b of liste.querySelectorAll('[aria-current="true"]')) b.removeAttribute("aria-current");
  const b = liste.querySelector(`[data-i="${actuel}"]`);
  if (b) {
    b.setAttribute("aria-current", "true");
    // (la liste défile seule pour le montrer : rien d'autre ne bouge sur la page)
    const haut = b.offsetTop, bas = haut + b.offsetHeight;
    if (haut < liste.scrollTop + 4) liste.scrollTop = Math.max(0, haut - 28);
    else if (bas > liste.scrollTop + liste.clientHeight - 4) liste.scrollTop = bas - liste.clientHeight + 8;
  }
  for (const c of Object.values(calques)) {
    for (const m of c.interieur.querySelectorAll("mark.actuelle")) m.classList.remove("actuelle");
    const m = c.interieur.querySelector(`mark[data-i="${actuel}"]`);
    if (m) m.classList.add("actuelle");
  }
  majEtat();
}

// On a écrit dans le texte : la recherche n'est plus à jour. Seuls des attributs et des textes changent
// (jamais rien de retiré de la page pendant la frappe : voir l'avertissement en haut).
function marquerPerime() {
  if (perime) return;
  perime = true;
  faits = []; // (les positions retenues ne sont plus sûres)
  for (const c of Object.values(calques)) c.calque.hidden = true;
  $("br-resultats").classList.add("perime");
  majEtat();
}

// ---------- Le calque : les passages surlignés derrière le texte ----------

function dessinerCalques() {
  for (const [mode, c] of Object.entries(calques)) {
    const ici = [];
    if (ouverte && !perime && motif && !$("editeur-plein").hidden && !c.zone.hidden) {
      resultats.forEach((r, i) => { if (r.scene.id === etat.sceneId && r.mode === mode) ici.push([r, i]); });
    }
    if (!ici.length) { cacherCalque(c); continue; }
    c.calque.hidden = false;
    copierStyles(c);
    const texte = c.zone.value, morceau = document.createDocumentFragment();
    let pos = 0;
    for (const [r, i] of ici) {
      morceau.append(texte.slice(pos, r.debut), el("mark", { "data-i": i, class: i === actuel ? "actuelle" : false }, texte.slice(r.debut, r.fin)));
      pos = r.fin;
    }
    // (le caractère invisible garde la dernière ligne, même vide : le calque défile aussi loin que le texte)
    morceau.append(texte.slice(pos) + "​");
    c.interieur.replaceChildren(morceau);
    suivreDefilement(c);
  }
}

function cacherCalque(c) {
  c.calque.hidden = true;
  // (pas vidé si le clavier est dans le texte : voir l'avertissement en haut ; il sera refait de toute façon)
  const dansLeTexte = document.activeElement && document.activeElement.classList.contains("texte");
  if (c.interieur.firstChild && !dansLeTexte) c.interieur.replaceChildren();
}

// Le calque prend exactement la place, la police et les marges de son texte (comme dans surlignage.js)
function copierStyles(c) {
  const cs = getComputedStyle(c.zone);
  const { gauche, haut, largeur, hauteur } = placeDuTexte(c.zone);
  const styles = STYLES_DU_TEXTE.map((p) => cs[p]).join("|") + "|" + [gauche, haut, largeur, hauteur].join("|");
  if (styles === c.styles) return;
  c.styles = styles;
  Object.assign(c.calque.style, { left: gauche + "px", top: haut + "px", width: largeur + "px", height: hauteur + "px" });
  for (const p of STYLES_DU_TEXTE) c.interieur.style[p] = cs[p];
}

function suivreDefilement(c) {
  if (c.calque.hidden) return;
  c.calque.scrollTop = c.zone.scrollTop;
  c.calque.scrollLeft = c.zone.scrollLeft;
}
