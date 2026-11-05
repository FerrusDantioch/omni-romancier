// =====================================================================
// STOCKAGE DES DONNÉES (IndexedDB = la base de données du navigateur)
// Tout reste sur cet appareil. Chaque écriture est enregistrée tout de suite.
//
// Les « tiroirs » (magasins) de la base :
//   romans     : { id, titre, univers, cree, modifie, ... }
//   chapitres  : { id, romanId, titre, ordre }
//   scenes     : { id, romanId, chapitreId, titre, ordre, notes, texte, mode }
//   fiches     : { id, romanId, categorie, titre, type, champs, notes }
//   reglages   : { cle, valeur }   (préférences et suivi des sauvegardes)
//
// Pour la fusion entre appareils (voir fusion.js), chaque écriture note toute seule la date
// de ce qui a changé, en trois parts suivies séparément (voir GROUPES) : le contenu (« majTexte »,
// avec « origine » = l'appareil qui l'a écrit), le titre (« majTitre ») et la place (« majPlace ») ;
// « maj » est la plus récente des trois.
// Chaque suppression laisse un « faire-part » dans les réglages : supprime:<tiroir>:<id> = date.
// =====================================================================

// (Nom hérité de l'ancien nom de l'application, « L'Atelier » : ne jamais le changer,
// sinon les romans déjà écrits ne seraient plus retrouvés.)
const NOM_BASE = "atelier-romans";
const VERSION_BASE = 1;
export const MAGASINS = ["romans", "chapitres", "scenes", "fiches", "reglages"];
const MAGASINS_DE_ROMAN = ["chapitres", "scenes", "fiches"]; // ceux qui appartiennent à un roman
export const MAGASINS_SUIVIS = ["romans", ...MAGASINS_DE_ROMAN];  // ceux que l'on fusionne entre appareils
export const PREFIXE_SUPPRESSION = "supprime:";
// Réglages propres à cet appareil : jamais exportés, jamais remplacés par un import
export const REGLAGES_LOCAUX = ["appareil", "receptions", "avantImport", "avantImportInfo"];
// Les parts suivies séparément. Tout champ qui n'est ni « titre » ni « place » fait partie du contenu.
// (Renommer une scène, la déplacer ou passer en mode Notes ne touche pas à son contenu :
// la fusion ne confond donc pas ces gestes avec une réécriture du texte.)
export const GROUPES = {
  romans:    { titre: [], place: [], ignores: ["modifie"] }, // (« modifie » change à chaque frappe : ce n'est pas du contenu)
  chapitres: { titre: ["titre"], place: ["ordre"], ignores: [] },
  scenes:    { titre: ["titre"], place: ["chapitreId", "ordre", "mode"], ignores: [] },
  fiches:    { titre: [], place: ["ordre"], ignores: [] },
};
// Le suivi lui-même ne compte jamais comme contenu
const CHAMPS_DE_SUIVI = new Set(["maj", "majTexte", "majTitre", "majPlace", "origine"]);
let idAppareil = null; // cet appareil (voir monAppareil)

// Les dates de chaque part (avec des valeurs de repli pour les données d'avant la version 1.2)
export function dateDe(e, part) {
  if (part === "place") return e.majPlace ?? 0;
  const texte = e.majTexte ?? e.maj ?? e.modifie ?? 0;
  return part === "titre" ? e.majTitre ?? texte : texte;
}
export function dateMaj(e) {
  return e.maj ?? Math.max(dateDe(e, "texte"), dateDe(e, "titre"), dateDe(e, "place"));
}

// Format du fichier de sauvegarde (pour le reconnaître à l'import)
// (Ancien nom gardé exprès : les sauvegardes déjà faites doivent rester lisibles.)
export const FORMAT_EXPORT = "atelier-romans";
export const VERSION_EXPORT = 1;

let base = null; // la base ouverte (gardée pour ne l'ouvrir qu'une fois)

// Transforme une demande IndexedDB en promesse (plus simple à utiliser avec await)
function attendre(demande) {
  return new Promise((ok, echec) => {
    demande.onsuccess = () => ok(demande.result);
    demande.onerror = () => echec(demande.error);
  });
}
// Attend la fin d'une transaction (= toutes les écritures sont bien sur le disque)
function finTransaction(tx) {
  return new Promise((ok, echec) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => echec(tx.erreurEcriture || tx.error);
    tx.onabort = () => echec(tx.erreurEcriture || tx.error || new Error("Écriture annulée"));
  });
}
// Annule toute la transaction (rien n'est écrit) en gardant la raison de l'échec
function abandonner(tx, erreur) {
  tx.erreurEcriture = erreur;
  try { tx.abort(); } catch { /* déjà terminée */ }
}

// Ouvre la base (et la crée la toute première fois)
export function ouvrirBase() {
  if (base) return Promise.resolve(base);
  return new Promise((ok, echec) => {
    if (!("indexedDB" in window)) {
      echec(new Error("Ce navigateur ne permet pas d'enregistrer des données."));
      return;
    }
    const demande = indexedDB.open(NOM_BASE, VERSION_BASE);
    demande.onupgradeneeded = () => {
      const db = demande.result;
      // Création des tiroirs et de leurs « index » (pour retrouver vite les éléments d'un roman)
      if (!db.objectStoreNames.contains("romans")) db.createObjectStore("romans", { keyPath: "id" });
      for (const nom of MAGASINS_DE_ROMAN) {
        if (!db.objectStoreNames.contains(nom)) {
          const magasin = db.createObjectStore(nom, { keyPath: "id" });
          magasin.createIndex("romanId", "romanId");
        }
      }
      if (!db.objectStoreNames.contains("reglages")) db.createObjectStore("reglages", { keyPath: "cle" });
    };
    demande.onsuccess = () => {
      base = demande.result;
      // Si une autre version de l'application s'ouvre dans un autre onglet, on se retire proprement
      base.onversionchange = () => { base.close(); base = null; };
      // Connexion coupée par le navigateur (rare) : elle sera rouverte à la prochaine écriture
      base.onclose = () => { base = null; };
      ok(base);
    };
    demande.onerror = () => echec(demande.error);
    demande.onblocked = () => echec(new Error("Fermez les autres onglets d'Omni-Romancier, puis rechargez la page."));
  });
}

// Demande au navigateur de ne jamais effacer nos données de lui-même
// (sinon il peut le faire s'il manque de place). Renvoie true si c'est accordé.
export async function protegerStockage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

// ---------- Lecture ----------

export async function lireTout(magasin) {
  const db = await ouvrirBase();
  return attendre(db.transaction(magasin).objectStore(magasin).getAll());
}

export async function lire(magasin, id) {
  const db = await ouvrirBase();
  return attendre(db.transaction(magasin).objectStore(magasin).get(id));
}

// Tous les éléments d'un roman (ex. lireDuRoman("scenes", idDuRoman))
export async function lireDuRoman(magasin, romanId) {
  const db = await ouvrirBase();
  return attendre(db.transaction(magasin).objectStore(magasin).index("romanId").getAll(romanId));
}

// ---------- Écriture ----------

// Note dans les réglages qu'il y a du nouveau à exporter (dans la même transaction)
function noterModification(tx) {
  const reglages = tx.objectStore("reglages");
  const demande = reglages.get("nonExporteDepuis");
  demande.onsuccess = () => {
    if (!demande.result || !demande.result.valeur) {
      reglages.put({ cle: "nonExporteDepuis", valeur: Date.now() });
    }
  };
}

// Deux éléments ont-ils le même contenu ? (le suivi ne compte pas, ni les champs « ignores »)
export function memeContenu(a, b, ignores = []) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const cles = (o) => Object.keys(o).filter((k) => o[k] !== undefined && !CHAMPS_DE_SUIVI.has(k) && !ignores.includes(k));
  const ka = cles(a), kb = cles(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && memeContenu(a[k], b[k]));
}

// Enregistre un élément en notant la date de ce qui a changé (comparé à la version déjà en base)
function poserAvecSuivi(tx, magasin, e, maintenant) {
  const tiroir = tx.objectStore(magasin);
  if (!MAGASINS_SUIVIS.includes(magasin)) { tiroir.put(e); return; }
  const demande = tiroir.get(e.id);
  demande.onsuccess = () => {
    try { poser(demande.result); } catch (erreur) { abandonner(tx, erreur); } // (écriture refusée : tout ou rien)
  };
  function poser(avant) {
    const g = GROUPES[magasin];
    const copie = { ...e };
    const change = (champs) => !avant || champs.some((k) => avant[k] !== e[k]);
    const contenuChange = !avant || !memeContenu(avant, e, [...g.titre, ...g.place, ...g.ignores]);
    copie.majTexte = contenuChange ? maintenant : dateDe(avant, "texte");
    if (g.titre.length) copie.majTitre = change(g.titre) ? maintenant : dateDe(avant, "titre");
    if (g.place.length) copie.majPlace = change(g.place) ? maintenant : dateDe(avant, "place");
    copie.maj = Math.max(copie.majTexte, copie.majTitre ?? 0, copie.majPlace ?? 0);
    // L'origine suit le contenu : c'est lui qui compte quand on a écrit des deux côtés
    const origine = contenuChange ? idAppareil : avant.origine;
    if (origine) copie.origine = origine; else delete copie.origine;
    tiroir.put(copie);
  }
}

// Laisse un « faire-part » de suppression (pour qu'une fusion ne fasse pas revenir l'élément)
function noterSuppression(tx, magasin, id, maintenant) {
  if (MAGASINS_SUIVIS.includes(magasin)) {
    tx.objectStore("reglages").put({ cle: `${PREFIXE_SUPPRESSION}${magasin}:${id}`, valeur: maintenant });
  }
}

// Enregistre (crée ou remplace) un ou plusieurs éléments d'un tiroir
export async function ecrire(magasin, ...elements) {
  const db = await ouvrirBase();
  const tx = db.transaction([magasin, "reglages"], "readwrite");
  const fin = finTransaction(tx);
  try {
    const maintenant = Date.now();
    for (const e of elements) poserAvecSuivi(tx, magasin, e, maintenant);
    noterModification(tx);
  } catch (erreur) {
    abandonner(tx, erreur);
  }
  return fin;
}

export async function supprimer(magasin, id) {
  const db = await ouvrirBase();
  const tx = db.transaction([magasin, "reglages"], "readwrite");
  tx.objectStore(magasin).delete(id);
  noterSuppression(tx, magasin, id, Date.now());
  noterModification(tx);
  return finTransaction(tx);
}

// Fait plusieurs écritures et suppressions d'un seul coup (tout ou rien).
// Exemple : lot({ ecrire: { scenes: [s1, s2] }, supprimer: { chapitres: [id] } })
export async function lot({ ecrire: aEcrire = {}, supprimer: aSupprimer = {} }) {
  const noms = [...new Set([...Object.keys(aEcrire), ...Object.keys(aSupprimer), "reglages"])];
  const db = await ouvrirBase();
  const tx = db.transaction(noms, "readwrite");
  const fin = finTransaction(tx);
  try {
    const maintenant = Date.now();
    for (const [nom, elements] of Object.entries(aEcrire)) {
      for (const e of elements) poserAvecSuivi(tx, nom, e, maintenant);
    }
    for (const [nom, ids] of Object.entries(aSupprimer)) {
      for (const id of ids) {
        tx.objectStore(nom).delete(id);
        noterSuppression(tx, nom, id, maintenant);
      }
    }
    noterModification(tx);
  } catch (erreur) {
    abandonner(tx, erreur); // tout ou rien
  }
  return fin;
}

// Supprime un roman ET tout ce qu'il contient (chapitres, scènes, fiches), d'un seul coup :
// soit tout est supprimé, soit rien (jamais à moitié).
export async function supprimerRoman(romanId) {
  const db = await ouvrirBase();
  const tx = db.transaction(["romans", ...MAGASINS_DE_ROMAN, "reglages"], "readwrite");
  const maintenant = Date.now();
  tx.objectStore("romans").delete(romanId);
  noterSuppression(tx, "romans", romanId, maintenant);
  for (const nom of MAGASINS_DE_ROMAN) {
    const index = tx.objectStore(nom).index("romanId");
    const demande = index.getAllKeys(romanId);
    demande.onsuccess = () => {
      for (const cle of demande.result) {
        tx.objectStore(nom).delete(cle);
        noterSuppression(tx, nom, cle, maintenant);
      }
    };
  }
  // Ses réglages (dernière scène ouverte, session, état du panneau) n'ont plus lieu d'être
  for (const prefixe of ["derniereScene:", "session:", "panneau:"]) tx.objectStore("reglages").delete(prefixe + romanId);
  noterModification(tx);
  return finTransaction(tx);
}

// ---------- Réglages (petites valeurs nommées) ----------

export async function lireReglage(cle, parDefaut = null) {
  const r = await lire("reglages", cle);
  return r ? r.valeur : parDefaut;
}

// Les réglages ne comptent pas comme « du nouveau à exporter »
export async function ecrireReglage(cle, valeur) {
  const db = await ouvrirBase();
  const tx = db.transaction("reglages", "readwrite");
  tx.objectStore("reglages").put({ cle, valeur });
  return finTransaction(tx);
}

// ---------- Cet appareil ----------

// L'identité de cet appareil (créée la première fois), pour reconnaître d'où vient un fichier
export async function monAppareil() {
  let appareil = await lireReglage("appareil");
  if (!appareil || typeof appareil.id !== "string") {
    appareil = { id: "app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) };
    await ecrireReglage("appareil", appareil);
  }
  idAppareil = appareil.id;
  return appareil;
}

// Toutes les données, telles qu'en base (sans la copie de sécurité d'avant import)
export async function lireToutesLesDonnees() {
  const db = await ouvrirBase();
  const tx = db.transaction(MAGASINS);
  const donnees = {};
  await Promise.all(MAGASINS.map(async (nom) => {
    donnees[nom] = await attendre(tx.objectStore(nom).getAll());
  }));
  donnees.reglages = donnees.reglages.filter((r) => r.cle !== "avantImport");
  return donnees;
}

// ---------- Export / import (sauvegarde de sécurité) ----------

// Rassemble TOUTES les données dans un seul objet, prêt à devenir un fichier JSON.
// Dans le fichier, l'export est déjà noté comme fait : réimporté plus tard,
// il ne déclenchera pas de rappel inutile.
// Le fichier dit aussi de quel appareil il vient, et ce que cet appareil a déjà reçu des autres.
export async function exporterTout(maintenant = Date.now(), nomAppareil = "") {
  const appareil = await monAppareil();
  const donnees = await lireToutesLesDonnees();
  const receptions = donnees.reglages.find((r) => r.cle === "receptions")?.valeur || {};
  donnees.reglages = donnees.reglages.filter((r) =>
    !REGLAGES_LOCAUX.includes(r.cle) && r.cle !== "derniereExport" && r.cle !== "nonExporteDepuis");
  donnees.reglages.push({ cle: "derniereExport", valeur: maintenant }, { cle: "nonExporteDepuis", valeur: null });
  return {
    format: FORMAT_EXPORT,
    version: VERSION_EXPORT,
    exporteLe: new Date(maintenant).toISOString(),
    appareil: { id: appareil.id, nom: nomAppareil },
    receptions,
    donnees,
  };
}

// D'où vient un fichier : { id, nom } de l'appareil, ou null (fichier d'une version précédente)
export function provenance(objet) {
  const a = objet && objet.appareil;
  return a && typeof a.id === "string" && a.id ? { id: a.id, nom: typeof a.nom === "string" ? a.nom : "" } : null;
}

// Ce que l'appareil du fichier avait déjà reçu des autres : { idAppareil: date }
export function receptionsDe(objet) {
  const r = objet && objet.receptions;
  const propres = {};
  if (r && typeof r === "object" && !Array.isArray(r)) {
    for (const [id, date] of Object.entries(r)) if (Number.isFinite(date)) propres[id] = date;
  }
  return propres;
}

// Note que l'export a réussi (seulement une fois le fichier créé)
export async function noterExport(maintenant) {
  const db = await ouvrirBase();
  const tx = db.transaction("reglages", "readwrite");
  tx.objectStore("reglages").put({ cle: "derniereExport", valeur: maintenant });
  tx.objectStore("reglages").put({ cle: "nonExporteDepuis", valeur: null });
  return finTransaction(tx);
}

// Ce que doit contenir chaque élément d'une sauvegarde :
//   ids     : identifiants obligatoires (du texte non vide)
//   textes  : champs facultatifs qui, s'ils sont là, doivent être du texte
//   nombres : champs facultatifs qui, s'ils sont là, doivent être des nombres
const REGLES = {
  romans:    { ids: ["id"], textes: ["titre", "univers", "ficheEpinglee", "ficheEpinglee2"], nombres: ["cree", "modifie", "objectifSession"] },
  chapitres: { ids: ["id", "romanId"], textes: ["titre"], nombres: ["ordre"] },
  scenes:    { ids: ["id", "romanId", "chapitreId"], textes: ["titre", "notes", "texte", "mode"], nombres: ["ordre", "modifie"] },
  fiches:    { ids: ["id", "romanId", "categorie"], textes: ["titre", "type", "notes"], nombres: ["ordre", "modifie"] },
  reglages:  { ids: ["cle"], textes: [], nombres: [] },
};
const CATEGORIES_FICHES = ["principal", "pnj", "lieu", "evenement"];

// Renvoie ce qui ne va pas dans un élément, ou null s'il est correct
function defautElement(nom, e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "un élément illisible";
  const regle = REGLES[nom];
  for (const champ of regle.ids) {
    if (typeof e[champ] !== "string" || e[champ] === "") return `un élément sans « ${champ} » valable`;
  }
  for (const champ of regle.textes) {
    if (e[champ] != null && typeof e[champ] !== "string") return `« ${champ} » n'est pas du texte`;
  }
  for (const champ of regle.nombres) {
    if (e[champ] != null && !Number.isFinite(e[champ])) return `« ${champ} » n'est pas un nombre`;
  }
  if (nom === "fiches") {
    if (!CATEGORIES_FICHES.includes(e.categorie)) return `une fiche de catégorie inconnue (« ${e.categorie} »)`;
    if (e.champs != null) {
      if (typeof e.champs !== "object" || Array.isArray(e.champs)) return "des champs de fiche illisibles";
      for (const v of Object.values(e.champs)) {
        const ok = v == null || typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
        if (!ok) return "un champ de fiche illisible";
      }
    }
  }
  return null;
}

// Vérifie qu'un objet lu dans un fichier est bien une sauvegarde d'Omni-Romancier.
// Renvoie un message d'erreur clair, ou null si tout va bien.
export function verifierSauvegarde(objet) {
  if (!objet || typeof objet !== "object") return "Ce fichier ne contient pas de données lisibles.";
  if (objet.format !== FORMAT_EXPORT) return "Ce fichier n'est pas une sauvegarde d'Omni-Romancier.";
  if (typeof objet.version !== "number" || objet.version > VERSION_EXPORT) {
    return "Cette sauvegarde vient d'une version plus récente d'Omni-Romancier. Mettez l'application à jour.";
  }
  const d = objet.donnees;
  if (!d || typeof d !== "object") return "La sauvegarde est incomplète (aucune donnée).";
  for (const nom of MAGASINS) {
    if (d[nom] === undefined) continue; // un tiroir absent = vide
    if (!Array.isArray(d[nom])) return `La sauvegarde est abîmée (partie « ${nom} »).`;
    const vus = new Set();
    for (const e of d[nom]) {
      const defaut = defautElement(nom, e);
      if (defaut) return `La sauvegarde est abîmée (partie « ${nom} » : ${defaut}).`;
      const cle = nom === "reglages" ? e.cle : e.id;
      if (vus.has(cle)) return `La sauvegarde est abîmée (partie « ${nom} » : identifiant en double).`;
      vus.add(cle);
    }
  }
  return null;
}

// Remplace TOUTES les données par celles de la sauvegarde.
// Tout se fait en une seule transaction : en cas de problème, rien n'est modifié.
// Une copie de l'état d'avant est gardée : « Annuler le dernier import » la remet en place.
export async function importerTout(objet, maintenant = Date.now()) {
  const erreur = verifierSauvegarde(objet);
  if (erreur) throw new Error(erreur);
  const appareil = await monAppareil();
  const avant = await lireToutesLesDonnees();
  // Ce que cet appareil aura « reçu » : ce que l'appareil du fichier avait reçu, plus le fichier lui-même
  const source = provenance(objet);
  const receptions = receptionsDe(objet);
  delete receptions[appareil.id];
  if (source && source.id !== appareil.id) receptions[source.id] = Date.parse(objet.exporteLe) || 0;
  const reglages = (objet.donnees.reglages || []).filter((r) => !REGLAGES_LOCAUX.includes(r.cle));
  reglages.push({ cle: "appareil", valeur: appareil }, { cle: "receptions", valeur: receptions });
  return remplacer({ ...objet.donnees, reglages }, { quand: maintenant, nature: "remplacement", avant });
}

// Applique le résultat d'une fusion (voir fusion.js) : tout ou rien, avec copie de l'état d'avant
export async function appliquerFusion({ donnees, tombes, source, exporteLe }, maintenant = Date.now()) {
  const avant = await lireToutesLesDonnees();
  const receptions = { ...(avant.reglages.find((r) => r.cle === "receptions")?.valeur || {}) };
  if (source) receptions[source.id] = Math.max(receptions[source.id] || 0, exporteLe || 0);
  const reglages = avant.reglages.filter((r) => !r.cle.startsWith(PREFIXE_SUPPRESSION) && r.cle !== "receptions");
  reglages.push(...tombes, { cle: "receptions", valeur: receptions });
  if (!reglages.some((r) => r.cle === "nonExporteDepuis" && r.valeur)) {
    reglages.push({ cle: "nonExporteDepuis", valeur: maintenant }); // du nouveau à exporter vers l'autre appareil
  }
  return remplacer({ ...donnees, reglages: reglages.filter((r, i, l) => l.findLastIndex((x) => x.cle === r.cle) === i) },
    { quand: maintenant, nature: "fusion", avant });
}

// Une fusion qui ne change rien : on note seulement ce qui a été reçu de l'autre appareil
// (sans toucher aux données, ni à la copie gardée pour « Annuler le dernier import »)
export async function noterReception(source, exporteLe) {
  if (!source) return;
  const db = await ouvrirBase();
  const tx = db.transaction("reglages", "readwrite");
  const fin = finTransaction(tx);
  const reglages = tx.objectStore("reglages");
  const demande = reglages.get("receptions");
  demande.onsuccess = () => {
    const receptions = { ...(demande.result?.valeur || {}) };
    receptions[source.id] = Math.max(receptions[source.id] || 0, exporteLe || 0);
    reglages.put({ cle: "receptions", valeur: receptions });
  };
  return fin;
}

// Remet les données d'avant le dernier import. L'état actuel est gardé à son tour :
// en cas d'erreur, le même bouton revient sur cette annulation (rien n'est jamais perdu d'un clic).
export async function annulerImport(maintenant = Date.now()) {
  const copie = await lireReglage("avantImport");
  if (!copie) throw new Error("Il n'y a pas d'import à annuler.");
  const avant = await lireToutesLesDonnees();
  return remplacer(copie, { quand: maintenant, nature: "annulation", avant });
}

// Remplace le contenu de tous les tiroirs, en une seule transaction.
// « copie » : l'état d'avant, gardé pour pouvoir annuler (null : ne rien garder).
async function remplacer(donnees, copie) {
  const db = await ouvrirBase();
  const tx = db.transaction(MAGASINS, "readwrite");
  const fin = finTransaction(tx);
  try {
    for (const nom of MAGASINS) {
      const magasin = tx.objectStore(nom);
      magasin.clear();
      for (const e of donnees[nom] || []) {
        if (nom !== "reglages" || (e.cle !== "avantImport" && e.cle !== "avantImportInfo")) magasin.put(e);
      }
    }
    if (copie) {
      tx.objectStore("reglages").put({ cle: "avantImport", valeur: copie.avant });
      tx.objectStore("reglages").put({ cle: "avantImportInfo", valeur: { quand: copie.quand, nature: copie.nature } });
    }
  } catch (probleme) {
    // Une écriture a été refusée : on annule TOUT (y compris l'effacement), puis on prévient
    try { tx.abort(); } catch { /* déjà annulée */ }
    fin.catch(() => {});
    throw probleme;
  }
  return fin;
}

// Nombre d'éléments, pour afficher un résumé avant import
export function resumerSauvegarde(objet) {
  const d = objet.donnees || {};
  const n = (nom) => (Array.isArray(d[nom]) ? d[nom].length : 0);
  return { romans: n("romans"), chapitres: n("chapitres"), scenes: n("scenes"), fiches: n("fiches") };
}
