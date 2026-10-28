// =====================================================================
// EXPORT : une scène, un chapitre ou le roman entier
// - en PDF, mis en page comme un livre (ce fichier) ;
// - en ePub (liseuse) ou en Word (.docx) : voir export-fichiers.js.
//
// Le PDF passe par l'impression du navigateur (choix « Enregistrer au format PDF ») :
// aucune dépendance, et cela fonctionne hors ligne. Le livre est construit dans
// un bloc invisible à l'écran (#impression) ; la mise en page est dans css/impression.css.
//
// Ce qui est exporté : uniquement le texte RÉDIGÉ (ni les notes, ni les fiches).
// Le seul nom qui apparaît est celui de SIGNATURE (le pseudonyme, voir export-fichiers.js).
// =====================================================================

import { estSautDePage } from "../commun/saut-de-page.js";
import { el } from "./outils.js";
import * as db from "./db.js";
import { etat, chapitresTries, scenesDe, trouverScene, trouverChapitre } from "./etat.js";
import { ouvrirDialogue, informer } from "./dialogues.js";
import { relireMaintenant, revenirAuTexte } from "./editeur.js";
import { SIGNATURE, creerEpub, creerDocx, telecharger } from "./export-fichiers.js";

// Les types de fichier proposés
const TYPES = {
  pdf: { nom: "PDF", usage: "un livre à imprimer ou à lire à l'écran", ok: "Préparer le PDF" },
  epub: { nom: "ePub", usage: "pour une liseuse ou une application de lecture", ok: "Créer le fichier ePub" },
  docx: { nom: "Word (.docx)", usage: "pour faire relire, annoter ou retravailler le texte", ok: "Créer le fichier Word" },
};

// Formats de page. « hauteurUtile » = hauteur de la page moins les marges (pour centrer la page de titre).
const FORMATS = {
  A5: { nom: "Livre (A5)", taille: "A5", marges: "20mm 18mm 22mm", hauteurUtile: "166mm", police: "10.5pt", hautChapitre: "28mm" },
  A4: { nom: "Page A4", taille: "A4", marges: "25mm 25mm 27mm", hauteurUtile: "243mm", police: "12pt", hautChapitre: "45mm" },
};

let pret = false;       // un livre est prêt à être imprimé
let fenetreOuverte = false; // la fenêtre « Exporter en PDF » est en train de s'ouvrir (évite d'en ouvrir deux)
let titreAvant = "";    // titre de l'onglet, remis après l'impression

const $ = (id) => document.getElementById(id);
// Un roman est ouvert, sur sa page d'écriture ou sur sa frise des événements
const pageDuRoman = () => !!etat.roman && (!$("vue-roman").hidden || !$("vue-frise").hidden);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserExportPdf() {
  $("bouton-pdf").addEventListener("click", () => ouvrirExport());
  // Bouton « Imprimer / PDF » de la barre d'outils : la même fenêtre, le PDF déjà choisi
  // (on y choisit le roman, un chapitre ou la scène, puis le format)
  $("bouton-imprimer").addEventListener("click", () => ouvrirExport({ type: "pdf" }));

  // Ctrl+P dans la page d'écriture (ou sur la frise) : notre export en PDF (au lieu d'imprimer l'écran tel quel)
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "p") return;
    if (!pageDuRoman()) return;
    e.preventDefault();
    if (!document.querySelector("dialog[open]")) ouvrirExport({ type: "pdf" });
  }, true);

  // Impression lancée par le menu du navigateur : on imprime le roman entier, au format livre
  window.addEventListener("beforeprint", () => {
    if (!pret && pageDuRoman()) preparer({ portee: "roman", format: "A5", pageDeTitre: true });
  });
  window.addEventListener("afterprint", nettoyer);
}

// =====================================================================
// La fenêtre « Exporter »
// =====================================================================

// type : le type de fichier coché d'avance (sinon, celui de la dernière fois)
export async function ouvrirExport({ type = null } = {}) {
  if (!etat.roman || fenetreOuverte) return;
  fenetreOuverte = true;
  try {
    await choisirEtExporter(type);
  } finally {
    fenetreOuverte = false;
  }
}

async function choisirEtExporter(typeVoulu) {
  relireMaintenant(); // les toutes dernières frappes comptent
  const chapitres = chapitresTries();
  if (!chapitres.length) {
    informer("Rien à exporter : ce roman n'a pas encore de chapitre.");
    return;
  }
  const scene = trouverScene(etat.sceneId);
  const chapitreOuvert = scene ? scene.chapitreId : chapitres[0].id;
  const memo = (await db.lireReglage("export-pdf", {}).catch(() => null)) || {};
  const formatMemo = FORMATS[memo.format] ? memo.format : "A5";
  const typeChoisi = TYPES[typeVoulu] ? typeVoulu : TYPES[memo.type] ? memo.type : "pdf";

  const radio = (nom, valeur, coche, ...libelle) =>
    el("label", { class: "option-export" },
      el("input", { type: "radio", name: nom, value: valeur, checked: coche }), el("span", {}, ...libelle));

  const choixChapitre = el("select", { name: "chapitre", "aria-label": "Chapitre à exporter",
    onchange: (e) => { e.target.form.elements.portee.value = "chapitre"; } },
  chapitres.map((c) => el("option", { value: c.id, selected: c.id === chapitreOuvert }, c.titre)));

  // Ce qui ne concerne que le PDF (format de page, conseil pour l'impression) n'apparaît que pour lui ;
  // le bouton dit ce qui va se passer
  const formatPdf = el("fieldset", { class: "groupe-export", hidden: typeChoisi !== "pdf" },
    el("legend", { class: "etiquette" }, "Format de page"),
    Object.entries(FORMATS).map(([cle, f]) => radio("format", cle, cle === formatMemo, f.nom)),
  );
  const conseilPdf = el("span", { hidden: typeChoisi !== "pdf" },
    " Dans la fenêtre d'impression qui va s'ouvrir, choisissez la destination « Enregistrer au format PDF ».");
  const surType = (e) => {
    const type = e.target.form.elements.type.value;
    formatPdf.hidden = conseilPdf.hidden = type !== "pdf";
    e.target.form.querySelector('button[type="submit"]').textContent = TYPES[type].ok;
  };

  const choix = await ouvrirDialogue({
    titre: "Exporter",
    corps: [
      el("fieldset", { class: "groupe-export" },
        el("legend", { class: "etiquette" }, "Que faut-il exporter ?"),
        radio("portee", "roman", true, "Le roman entier"),
        el("div", { class: "option-export-chapitre" }, radio("portee", "chapitre", false, "Un chapitre :"), choixChapitre),
        scene ? radio("portee", "scene", false, "La scène ouverte : ", el("em", {}, scene.titre || "Sans titre")) : null,
      ),
      el("fieldset", { class: "groupe-export", onchange: surType },
        el("legend", { class: "etiquette" }, "Type de fichier"),
        Object.entries(TYPES).map(([cle, t]) => radio("type", cle, cle === typeChoisi,
          el("b", {}, t.nom), el("span", { class: "discret" }, " — " + t.usage))),
      ),
      formatPdf,
      el("label", { class: "option-export" },
        el("input", { type: "checkbox", name: "pageDeTitre", checked: memo.pageDeTitre !== false }),
        el("span", {}, "Page de titre")),
      el("p", { class: "discret petit" }, "Seul le texte rédigé est exporté (ni les notes, ni les fiches).", conseilPdf),
    ],
    ok: TYPES[typeChoisi].ok,
    lireFormulaire: (form) => ({
      type: form.elements.type.value,
      portee: form.elements.portee.value,
      chapitreId: form.elements.chapitre.value,
      format: form.elements.format.value,
      pageDeTitre: form.elements.pageDeTitre.checked,
    }),
  });
  if (!choix) return;
  db.ecrireReglage("export-pdf", { type: choix.type, format: choix.format, pageDeTitre: choix.pageDeTitre }).catch(() => {});
  if (choix.type !== "pdf") { exporterFichier(choix); return; }
  if (!preparer(choix)) return;
  await imprimer();
}

// ePub ou Word : le fichier est créé, puis téléchargé
function exporterFichier(choix) {
  const contenu = contenuDuLivre(choix);
  if (!contenu) return;
  const livre = { ...contenu, pageDeTitre: choix.pageDeTitre, idRoman: etat.roman.id };
  try {
    const { fichier, nom } = (choix.type === "epub" ? creerEpub : creerDocx)(livre);
    telecharger(fichier, nom);
    informer(`Fichier créé : « ${nom} ». Il est dans vos téléchargements.`, { duree: 6000 });
  } catch (erreur) {
    informer("Le fichier n'a pas pu être créé : " + erreur.message, { erreur: true });
  }
  revenirAuTexte();
}

// =====================================================================
// Construction du livre
// =====================================================================

// Ce qu'on exporte (pour le PDF comme pour l'ePub et le Word) :
// { titre, sousTitre, chapitres: [{ titre, blocs }], nom }, les blocs étant les paragraphes du livre
// (<p>, avec <em> et <strong> ; un séparateur a la classe « livre-separateur », et un paragraphe
// qui suit un saut de page, la classe « livre-nouvelle-page »).
// Les titres sont mis en forme (espaces insécables…) ; « nom » est le titre tel quel (pour le nom du fichier).
// Renvoie null (et le dit) s'il n'y a rien à exporter.
export function contenuDuLivre({ portee, chapitreId }) {
  relireMaintenant();

  // 1. Des chapitres, chacun avec ses scènes
  let parties, sousTitre = null;
  if (portee === "scene") {
    const s = trouverScene(etat.sceneId);
    const c = s && trouverChapitre(s.chapitreId);
    if (!s || !c) return false;
    parties = [{ chapitre: c, scenes: [s] }];
    sousTitre = `${c.titre} — ${s.titre || "Sans titre"}`;
  } else if (portee === "chapitre") {
    const c = trouverChapitre(chapitreId);
    if (!c) return false;
    parties = [{ chapitre: c, scenes: scenesDe(c.id) }];
    sousTitre = c.titre;
  } else {
    parties = chapitresTries().map((c) => ({ chapitre: c, scenes: scenesDe(c.id) }));
  }

  // 2. Chaque chapitre devient une suite de paragraphes ; les scènes vides sont ignorées
  const chapitres = parties
    .map(({ chapitre, scenes }) => ({ chapitre, blocs: blocsDuChapitre(scenes) }))
    .filter((c) => c.blocs.length);
  if (!chapitres.length) {
    informer("Rien à exporter : le texte rédigé est vide (les notes ne sont jamais exportées).");
    return null;
  }
  return {
    titre: typographie(etat.roman.titre || "Sans titre"),
    sousTitre: sousTitre ? typographie(sousTitre) : null,
    chapitres: chapitres.map(({ chapitre, blocs }) => ({ titre: typographie(chapitre.titre || "Sans titre"), blocs })),
    nom: etat.roman.titre + (sousTitre ? " — " + sousTitre : ""),
  };
}

// Prépare le livre dans #impression. Renvoie false s'il n'y a rien à exporter.
export function preparer({ portee, chapitreId, format = "A5", pageDeTitre = true }) {
  const contenu = contenuDuLivre({ portee, chapitreId });
  if (!contenu) return false;
  const f = FORMATS[format] || FORMATS.A5;
  const sousTitre = contenu.sousTitre;

  // Le livre
  const livre = contenu.chapitres.map(({ titre, blocs }) =>
    el("section", { class: "livre-chapitre" },
      el("h2", { class: "livre-titre-chapitre" }, titre),
      blocs));
  if (pageDeTitre) livre.unshift(pageTitre(sousTitre));
  $("impression").replaceChildren(...livre);
  styleDePage(f, pageDeTitre);
  document.documentElement.classList.add("impression-livre");
  // Le titre de l'onglet devient le nom proposé pour le fichier PDF
  if (!pret) titreAvant = document.title;
  document.title = contenu.nom;
  pret = true;
  return true;
}

// Lance l'impression, une fois les polices (italique, gras) bien chargées
async function imprimer() {
  try {
    await Promise.all(["400 1em Literata", "italic 400 1em Literata", "600 1em Literata", "italic 700 1em Literata"]
      .map((p) => document.fonts.load(p)));
    await document.fonts.ready;
  } catch { /* tant pis : le navigateur utilisera une police de remplacement */ }
  window.print();
}

// Après l'impression : on vide le livre et tout redevient comme avant
function nettoyer() {
  if (!pret) return;
  pret = false;
  $("impression").replaceChildren();
  const style = $("style-page-livre");
  if (style) style.remove(); // une impression ordinaire, plus tard, ne garde pas le format du livre
  document.documentElement.classList.remove("impression-livre");
  document.title = titreAvant;
  revenirAuTexte();
}

function pageTitre(sousTitre) {
  return el("section", { class: "livre-page-titre" },
    el("h1", { class: "livre-titre" }, typographie(etat.roman.titre)),
    sousTitre ? el("p", { class: "livre-sous-titre" }, sousTitre) : null,
    el("hr", { class: "livre-filet" }),
    el("p", { class: "livre-signature" }, SIGNATURE),
  );
}

// Règles de page (format, marges, numéro de page, mention en pied de page)
function styleDePage(f, pageDeTitre) {
  let style = $("style-page-livre");
  if (!style) {
    style = el("style", { id: "style-page-livre" });
    document.head.append(style);
  }
  const pied = `font: italic 7pt "Literata", Georgia, serif; color: #555;`;
  style.textContent = `
@media print {
  @page {
    size: ${f.taille};
    margin: ${f.marges};
    @bottom-center { content: counter(page); font: 9pt "Literata", Georgia, serif; color: #000; }
    @bottom-right { content: "${SIGNATURE}"; ${pied} }
  }
  ${pageDeTitre ? "@page :first { @bottom-center { content: none; } @bottom-right { content: none; } }" : ""}
  html.impression-livre {
    --livre-police: ${f.police};
    --livre-hauteur: ${f.hauteurUtile};
    --livre-haut-chapitre: ${f.hautChapitre};
  }
}`;
}

// =====================================================================
// Du texte de l'éditeur aux paragraphes du livre
// =====================================================================

// Une ligne « * * * » (ou « *** », « ⁂ ») = séparateur de scène
function estSeparateur(ligne) {
  return /^(\*\s*){3}$/.test(ligne) || ligne === "⁂";
}

// Les paragraphes d'un chapitre. Entre deux scènes, un séparateur « * * * »
// (sauf si le texte en a déjà un à cet endroit). Jamais de séparateur au début ou à la fin.
// Un saut de page (ligne « ──── Saut de page ──── ») fait commencer le paragraphe suivant sur une
// nouvelle page. Il remplace un séparateur voisin (la nouvelle page marque déjà le changement),
// et il est ignoré au début ou à la fin d'un chapitre (un chapitre commence déjà sur une nouvelle
// page) : jamais de page blanche. Plusieurs sauts à la suite n'en font qu'un.
function blocsDuChapitre(scenes) {
  const lignes = [];
  for (const s of scenes) {
    const texte = (s.texte || "").trim();
    if (!texte) continue;
    if (lignes.length) lignes.push("* * *");
    lignes.push(...texte.split("\n"));
  }
  const blocs = [];
  let separateurEnAttente = false, sautEnAttente = false;
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue; // les lignes vides ne servent qu'à aérer l'écriture
    if (estSautDePage(ligne)) { sautEnAttente = blocs.length > 0; continue; }
    if (estSeparateur(ligne)) { separateurEnAttente = blocs.length > 0; continue; }
    if (separateurEnAttente && !sautEnAttente) blocs.push(el("p", { class: "livre-separateur", "aria-label": "Changement de scène" }, "*\u2003*\u2003*"));
    blocs.push(el("p", sautEnAttente ? { class: "livre-nouvelle-page" } : {}, enLigne(typographie(ligne))));
    separateurEnAttente = sautEnAttente = false;
  }
  return blocs;
}

// Espaces insécables de la typographie française (le texte enregistré, lui, n'est pas modifié) :
// pas de « ? » ou de « » » seul en début de ligne.
// Et l'apostrophe droite entre deux lettres devient typographique (l'homme → l’homme).
function typographie(t) {
  return t
    .replace(/(\p{L})'(?=\p{L})/gu, "$1\u2019")
    .replace(/ +([:;!?»])/g, "\u00A0$1")
    .replace(/« +/g, "«\u00A0")
    .replace(/^([—–]) +/, "$1\u00A0")
    .replace(/ +([—–]) /g, "\u00A0$1 ");
}

// *italique*, **gras**, ***les deux*** → mise en forme, y compris l'un dans l'autre
// (« **Arrête, *maintenant*** », « ***Non**, dit-elle.* »). Une étoile isolée reste telle quelle.
function enLigne(texte) {
  // 1. Découpage : morceaux de texte et paquets d'étoiles.
  //    Un paquet peut ouvrir s'il est collé au mot qui suit, fermer s'il est collé au mot qui précède.
  const morceaux = [];
  const etoiles = /\*+/g;
  let fin = 0;
  for (let r; (r = etoiles.exec(texte));) {
    if (r.index > fin) morceaux.push(texte.slice(fin, r.index));
    const avant = texte[r.index - 1];
    const apres = texte[r.index + r[0].length];
    morceaux.push({ etoiles: r[0].length, ouvre: !!apres && !/\s/.test(apres), ferme: !!avant && !/\s/.test(avant) });
    fin = r.index + r[0].length;
  }
  if (fin < texte.length) morceaux.push(texte.slice(fin));

  // 2. Chaque paquet qui ferme s'associe au plus proche paquet ouvrant qui le précède :
  //    deux étoiles de chaque côté → gras, une seule → italique. Ce qui est entre les deux est mis en forme.
  const estPaquet = (m, sens) => m.etoiles > 0 && m[sens];
  for (let j = 0; j < morceaux.length; j++) {
    const fermant = morceaux[j];
    if (!estPaquet(fermant, "ferme")) continue;
    let i = j - 1;
    while (fermant.etoiles > 0) {
      while (i >= 0 && !estPaquet(morceaux[i], "ouvre")) i--;
      if (i < 0) break;
      const ouvrant = morceaux[i];
      const n = ouvrant.etoiles >= 2 && fermant.etoiles >= 2 ? 2 : 1;
      const contenu = morceaux.splice(i + 1, j - i - 1, null);
      morceaux[i + 1] = el(n === 2 ? "strong" : "em", {}, enNoeuds(contenu));
      j = i + 2;
      ouvrant.etoiles -= n; // les étoiles en trop restent à l'extérieur
      fermant.etoiles -= n;
    }
  }
  return enNoeuds(morceaux);
}

// Les étoiles restées sans partenaire redeviennent du texte
function enNoeuds(morceaux) {
  return morceaux
    .map((m) => (typeof m === "string" || m instanceof Node ? m : "*".repeat(m.etoiles)))
    .filter((m) => m !== "");
}
