// =====================================================================
// SAUVEGARDE DE SÉCURITÉ : export / import d'un fichier JSON + rappel doux
// Les données ne vivent que sur cet appareil : un export régulier permet
// de les retrouver si l'ordinateur ou le navigateur a un problème.
// Le même fichier sert à passer d'un appareil à l'autre : à l'import, on peut
// FUSIONNER (voir fusion.js) au lieu de tout remplacer. Et le dernier import s'annule.
// =====================================================================

import * as db from "./db.js";
import { dateFichier, ilYa, dateCourte, dateHeure, pluriel, el, nomAppareil } from "./outils.js";
import { ouvrirDialogue, informer } from "./dialogues.js";
import { fusionner, bilanVide } from "./fusion.js";

// Le rappel apparaît quand des modifications n'ont pas été exportées depuis ce nombre de jours
const JOURS_AVANT_RAPPEL = 3;
// « Plus tard » cache le rappel pendant ce nombre de jours
const JOURS_DE_REPORT = 2;
const JOUR = 86400000;

let apresImport = async () => {};
let avantExport = async () => {};

export function initialiserSauvegarde({ quandImporte, avantExporter }) {
  apresImport = quandImporte;
  avantExport = avantExporter;
  document.querySelectorAll("[data-action=exporter]").forEach((b) => b.addEventListener("click", exporter));
  document.getElementById("bouton-importer").addEventListener("click", () => document.getElementById("fichier-import").click());
  document.getElementById("fichier-import").addEventListener("change", (e) => {
    const fichier = e.target.files[0];
    e.target.value = ""; // permet de choisir à nouveau le même fichier plus tard
    if (fichier) importer(fichier);
  });
  document.getElementById("bouton-annuler-import").addEventListener("click", annulerDernierImport);
  document.getElementById("bouton-plus-tard").addEventListener("click", async () => {
    await db.ecrireReglage("rappelReporteJusqua", Date.now() + JOURS_DE_REPORT * JOUR);
    mettreAJourEtat();
  });
}

// ---------- Export ----------

export async function exporter() {
  try {
    const complet = await avantExport(); // les toutes dernières frappes d'abord
    const maintenant = Date.now();
    const appareil = nomAppareil();
    const sauvegarde = await db.exporterTout(maintenant, appareil);
    const texte = JSON.stringify(sauvegarde, null, 2); // indenté : lisible si on l'ouvre
    const fichier = new Blob([texte], { type: "application/json" });
    // Le nom dit la date et l'appareil : omni-romancier-sauvegarde-2026-10-15-telephone-android.json
    const suffixe = appareil.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const lien = el("a", { href: URL.createObjectURL(fichier), download: `omni-romancier-sauvegarde-${dateFichier()}-${suffixe}.json` });
    document.body.append(lien);
    lien.click();      // déclenche le téléchargement
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
    if (complet === false) {
      // Le fichier est créé quand même (mieux que rien), mais on ne prétend pas que tout est exporté
      informer("Export fait, mais du texte récent n'a pas pu être enregistré et ne figure PAS dans ce fichier. "
        + "Réessayez l'export dans un moment.", { erreur: true, duree: 15000 });
    } else {
      await db.noterExport(maintenant);
      informer("Sauvegarde exportée. Rangez le fichier en lieu sûr (clé USB, cloud…).");
    }
  } catch (erreur) {
    informer("L'export a échoué : " + erreur.message, { erreur: true });
  }
  mettreAJourEtat();
}

// ---------- Import ----------

export async function importer(fichier) {
  // 1. Lire le fichier
  let sauvegarde;
  try {
    sauvegarde = JSON.parse(await fichier.text());
  } catch {
    informer("Ce fichier est illisible : ce n'est pas une sauvegarde d'Omni-Romancier.", { erreur: true });
    return;
  }
  const erreur = db.verifierSauvegarde(sauvegarde);
  if (erreur) {
    informer(erreur, { erreur: true });
    return;
  }

  // 2. Ce qu'une fusion changerait ici (à partir des données à jour : les toutes dernières frappes d'abord)
  let appareil, fusion = null;
  const source = db.provenance(sauvegarde);
  try {
    // (du texte récent n'a pas pu être enregistré : l'import l'effacerait, on s'arrête là)
    if (await avantExport() === false) {
      informer("Du texte récent n'a pas encore pu être enregistré : l'import est annulé pour ne pas le perdre. "
        + "Réessayez dans un moment.", { erreur: true, duree: 10000 });
      return;
    }
    appareil = await db.monAppareil();
    if (source?.id !== appareil.id) {
      const local = await db.lireToutesLesDonnees();
      const receptions = local.reglages.find((x) => x.cle === "receptions")?.valeur || {};
      fusion = fusionner(local, sauvegarde.donnees, {
        ici: appareil.id,
        baseLocale: db.receptionsDe(sauvegarde)[appareil.id] ?? 0,   // ce que l'autre appareil a déjà reçu d'ici
        baseDistante: source ? receptions[source.id] ?? 0 : 0,       // ce que nous avons déjà reçu de lui
        noms: { local: nomAppareil(), distant: source?.nom || "l'autre appareil" },
      });
    }
  } catch (e) {
    informer("L'import a échoué, rien n'a été modifié : " + e.message, { erreur: true });
    return;
  }

  // 3. Demander quoi faire, en montrant ce que contient le fichier et ce que la fusion changerait
  const r = db.resumerSauvegarde(sauvegarde);
  const date = Date.parse(sauvegarde.exporteLe);
  const origine = !source ? "" : source.id === appareil.id ? " sur cet appareil" : source.nom ? " depuis " + avecArticle(source.nom) : "";
  const corps = [
    el("p", {}, `Fichier « ${fichier.name} »` + (isNaN(date) ? "" : `, exporté le ${dateHeure(date)}`) + origine + " :"),
    el("ul", { class: "losanges" },
      el("li", {}, pluriel(r.romans, "roman")),
      el("li", {}, pluriel(r.chapitres, "chapitre") + ", " + pluriel(r.scenes, "scène")),
      el("li", {}, pluriel(r.fiches, "fiche")),
    ),
  ];
  if (fusion) {
    corps.push(
      el("p", {}, el("strong", {}, "Fusionner (conseillé) : "),
        "ajoute ce qui est nouveau et garde, pour chaque scène et chaque fiche, la version la plus récente. Rien de ce qui a été écrit ici n'est perdu."),
      bilanVide(fusion.bilan)
        ? el("p", { class: "discret" }, "Rien de nouveau dans ce fichier : tout est déjà à jour ici.")
        : el("ul", { class: "losanges" }, lignesBilan(fusion.bilan).map((l) => el("li", {}, l))),
      el("p", { class: "discret" }, "« Remplacer tout » efface plutôt les données de cet appareil pour mettre celles du fichier."),
    );
  } else {
    corps.push(el("p", { class: "avertissement" }, "C'est une sauvegarde faite sur cet appareil : les données actuelles seront remplacées "
      + "par celles du fichier (ce qui a été écrit depuis sera retiré)."));
  }
  if (!r.romans) {
    corps.push(el("p", { class: "avertissement" }, "Attention : ce fichier ne contient aucun roman. "
      + "Le remplacement viderait la bibliothèque de cet appareil."));
  }
  corps.push(el("p", { class: "discret" }, "Dans tous les cas, « Annuler le dernier import » (dans la sauvegarde de sécurité) permet de revenir en arrière."));
  const choix = await ouvrirDialogue({
    titre: "Importer cette sauvegarde ?",
    corps,
    ok: fusion ? "Fusionner" : "Remplacer mes données",
    danger: !fusion,
    autres: fusion ? [{ texte: "Remplacer tout", valeur: "remplacer", danger: true }] : [],
  });
  if (!choix) return;
  const parFusion = fusion && choix === true;

  // 4. Fusionner, ou tout remplacer.
  // (Une fusion qui ne change rien note seulement ce qui a été reçu de l'autre appareil :
  // elle ne prend pas la place de la copie gardée pour « Annuler le dernier import ».)
  const rien = parFusion && bilanVide(fusion.bilan);
  try {
    if (rien) await db.noterReception(source, date);
    else if (parFusion) await db.appliquerFusion({ donnees: fusion.donnees, tombes: fusion.tombes, source, exporteLe: date });
    else await db.importerTout(sauvegarde);
  } catch (e) {
    informer("L'import a échoué, rien n'a été modifié : " + e.message, { erreur: true });
    mettreAJourEtat();
    return;
  }
  if (rien) {
    informer("Rien de nouveau : tout était déjà à jour ici.");
    mettreAJourEtat();
    return;
  }
  if (parFusion) {
    const b = fusion.bilan;
    const gardes = Object.values(b.gardes).reduce((a, n) => a + n, 0);
    const doubles = [
      b.conflitsScenes ? `${pluriel(b.conflitsScenes, "scène")} écrite${b.conflitsScenes > 1 ? "s" : ""} sur les deux appareils : `
        + "l'autre version suit la scène dans le plan, « (autre version : …) »." : "",
      b.conflitsFiches ? `${pluriel(b.conflitsFiches, "fiche")} modifiée${b.conflitsFiches > 1 ? "s" : ""} sur les deux appareils : `
        + "l'autre version est recopiée dans ses notes." : "",
      gardes ? `${pluriel(gardes, "élément supprimé", "éléments supprimés")} sur un appareil mais réécrit${gardes > 1 ? "s" : ""} sur l'autre `
        + `sans qu'il l'ait vu : gardé${gardes > 1 ? "s" : ""} (à supprimer de nouveau si c'était voulu).` : "",
    ].filter(Boolean).join(" ");
    informer("Fusion faite." + (doubles ? " " + doubles : ""), { duree: doubles ? 15000 : 5000 });
  } else {
    informer("Sauvegarde importée : les données du fichier ont remplacé celles de cet appareil.");
  }
  await apresImport();
  mettreAJourEtat();
}

// « un téléphone Android », « une tablette Android »
function avecArticle(nom) {
  return (/^tablette/.test(nom) ? "une " : "un ") + nom;
}

// Ce que la fusion changerait, en quelques lignes
function lignesBilan(b) {
  const NOMS = { romans: ["roman", "romans"], chapitres: ["chapitre", "chapitres"], scenes: ["scène", "scènes"], fiches: ["fiche", "fiches"] };
  const liste = (compte) => Object.entries(compte).filter(([, n]) => n > 0).map(([cle, n]) => pluriel(n, ...NOMS[cle])).join(", ");
  return [
    liste(b.ajoutes) && "À ajouter : " + liste(b.ajoutes),
    liste(b.modifies) && "À mettre à jour (plus récent dans le fichier) : " + liste(b.modifies),
    liste(b.supprimes) && "À supprimer (supprimé sur l'autre appareil) : " + liste(b.supprimes),
    liste(b.gardes) && "Supprimé sur un appareil, mais réécrit sur l'autre sans qu'il l'ait vu, donc gardé : " + liste(b.gardes),
    b.conflitsScenes && `${pluriel(b.conflitsScenes, "scène")} écrite${b.conflitsScenes > 1 ? "s" : ""} sur les deux appareils : les deux versions seront gardées`,
    b.conflitsFiches && `${pluriel(b.conflitsFiches, "fiche")} modifiée${b.conflitsFiches > 1 ? "s" : ""} sur les deux appareils : l'autre version sera recopiée dans ses notes`,
    b.recuperes && `${pluriel(b.recuperes, "élément")} supprimé${b.recuperes > 1 ? "s" : ""} d'un côté mais utilisé${b.recuperes > 1 ? "s" : ""} de l'autre : récupéré${b.recuperes > 1 ? "s" : ""}`,
  ].filter(Boolean);
}

// ---------- Annuler le dernier import ----------

// (après une annulation, le même bouton revient sur elle : « nature » vaut alors « annulation »)
async function annulerDernierImport() {
  const info = await db.lireReglage("avantImportInfo");
  if (!info) return;
  const retour = info.nature === "annulation";
  const ok = await ouvrirDialogue({
    titre: retour ? "Revenir sur l'annulation ?" : "Annuler le dernier import ?",
    corps: [
      el("p", {}, retour
        ? `Omni-Romancier revient exactement à son état d'avant l'annulation du ${dateHeure(info.quand)}.`
        : `Omni-Romancier revient exactement à son état d'avant l'import du ${dateHeure(info.quand)}.`),
      el("p", { class: "avertissement" }, retour
        ? "Ce qui a été écrit ou modifié depuis cette annulation sera retiré aussi."
        : "Ce qui a été écrit ou modifié depuis cet import sera retiré aussi."),
      el("p", { class: "discret" }, "L'état actuel est gardé : ce même bouton permettra d'y revenir."),
    ],
    annuler: "Garder tel quel",
    ok: retour ? "Revenir avant l'annulation" : "Revenir avant l'import",
    danger: true,
  });
  if (!ok) return;
  try {
    await avantExport();
    await db.annulerImport();
  } catch (e) {
    informer("L'import n'a pas pu être annulé : " + e.message, { erreur: true });
    return;
  }
  informer("C'est fait : Omni-Romancier est revenu à son état d'avant. (Changement d'avis ? Le même bouton y revient.)",
    { duree: 8000 });
  await apresImport();
  mettreAJourEtat();
}

// ---------- État de la sauvegarde et rappel doux ----------

export async function mettreAJourEtat() {
  const [derniereExport, nonExporteDepuis, reporteJusqua, protege, dernierImport] = await Promise.all([
    db.lireReglage("derniereExport"),
    db.lireReglage("nonExporteDepuis"),
    db.lireReglage("rappelReporteJusqua", 0),
    navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : false,
    db.lireReglage("avantImportInfo"),
  ]);
  const bouton = document.getElementById("bouton-annuler-import");
  bouton.hidden = !dernierImport;
  bouton.textContent = dernierImport?.nature === "annulation" ? "Revenir sur l'annulation" : "Annuler le dernier import";

  // Texte de la carte « Sauvegarde de sécurité »
  const etat = document.getElementById("etat-sauvegarde");
  if (etat) {
    etat.replaceChildren(
      el("li", {}, derniereExport ? `Dernier export : ${ilYa(derniereExport)} (${dateCourte(derniereExport)})` : "Aucun export pour l'instant."),
      el("li", {}, nonExporteDepuis ? "Des modifications n'ont pas encore été exportées." : "Tout est exporté."),
      el("li", {}, protege
        ? "Le navigateur s'est engagé à ne pas effacer ces données."
        : "Le navigateur pourrait effacer ces données s'il manque de place : exportez régulièrement."),
      // (sans import, aucune ligne : « null » s'afficherait sinon tel quel dans la liste)
      ...(dernierImport ? [el("li", {}, dernierImport.nature === "annulation"
        ? `Dernier import annulé le ${dateHeure(dernierImport.quand)} (on peut revenir sur cette annulation).`
        : `Dernier import : ${dateHeure(dernierImport.quand)}`
          + (dernierImport.nature === "fusion" ? " (fusion)" : " (remplacement)") + ", annulable.")] : []),
    );
  }

  // Bandeau de rappel en haut de l'écran
  const maintenant = Date.now();
  const afficher = !!nonExporteDepuis
    && maintenant - nonExporteDepuis >= JOURS_AVANT_RAPPEL * JOUR
    && maintenant >= reporteJusqua;
  const bandeau = document.getElementById("rappel-export");
  bandeau.hidden = !afficher;
  if (afficher) {
    document.getElementById("rappel-texte").textContent = derniereExport
      ? `Vos textes ne sont enregistrés que sur cet appareil. Dernier export : ${ilYa(derniereExport)}.`
      : "Vos textes ne sont enregistrés que sur cet appareil, et vous ne les avez jamais exportés.";
  }
}
