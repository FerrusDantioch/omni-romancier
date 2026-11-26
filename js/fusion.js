// =====================================================================
// FUSION ENTRE APPAREILS
// On importe le fichier d'un autre appareil (par exemple le téléphone) sans rien écraser :
//   - ce qui est nouveau est ajouté ;
//   - pour chaque élément présent des deux côtés, la version la plus récente est gardée,
//     en trois parts prises séparément (voir GROUPES dans db.js) : le contenu, le titre, la place.
//     Une scène renommée ici et réécrite là-bas garde donc le nouveau titre ET le nouveau texte ;
//   - ce qui a été supprimé d'un côté (voir les « faire-part » de db.js) est supprimé de l'autre,
//     sauf s'il a été modifié après la suppression, ou modifié sur un appareil sans que celui qui l'a
//     supprimé ait jamais vu cette version (on ne jette jamais un travail que l'autre n'a pas vu) ;
//   - une scène dont le texte a été écrit DES DEUX CÔTÉS depuis le dernier échange garde les deux
//     versions : la plus récente à sa place, l'autre juste après, « (autre version : …) ».
//     Pour une fiche, l'autre version est recopiée dans ses notes.
//
// « Depuis le dernier échange » : chaque fichier dit ce que son appareil avait déjà reçu de
// celui-ci (receptions), et cet appareil sait ce qu'il a reçu de l'autre ; chaque contenu dit
// aussi quel appareil l'a écrit (origine), pour ne pas confondre « écrit ici » et « reçu ».
// Aucune écriture ici : on calcule seulement le résultat (appliqué ensuite par db.appliquerFusion).
// =====================================================================

import { PREFIXE_SUPPRESSION, MAGASINS_SUIVIS, GROUPES, memeContenu, dateDe, dateMaj } from "./db.js";

// Libellés des champs de fiche (pour recopier une autre version dans les notes)
const LIBELLES = {
  titre: "Nom", type: "Type", autresNoms: "Autres noms", apparence: "Apparence", caractere: "Caractère",
  background: "Background", objectif: "Objectif", arc: "Arc narratif", relations: "Relations",
  description: "Description", ambiance: "Ambiance", symbolique: "Rôle dans le récit",
  quand: "Date ou moment", resume: "Résumé", enjeu: "Enjeu & conséquences", notes: "Notes",
};
const CHAMP_DE_DATE = { titre: "majTitre", place: "majPlace" };

// local, distant : { romans, chapitres, scenes, fiches, reglages } (tableaux)
// ici          : l'identifiant de cet appareil
// baseLocale   : date (de cet appareil) jusqu'à laquelle l'autre appareil a reçu nos modifications
// baseDistante : date (de l'autre appareil) jusqu'à laquelle nous avons reçu les siennes
// noms         : { local, distant } noms lisibles des deux appareils
export function fusionner(local, distant, { maintenant = Date.now(), ici = null, baseLocale = 0, baseDistante = 0, noms = {} } = {}) {
  // Un contenu a-t-il été écrit ici (et pas seulement reçu de l'autre appareil) depuis le dernier échange ?
  // (sans origine connue, données d'avant la version 1.2 : on suppose que oui, par prudence)
  const ecritIci = (e) => (e.origine == null || e.origine === ici) && dateDe(e, "texte") > baseLocale;
  const ecritLaBas = (e) => e.origine !== ici && dateDe(e, "texte") > baseDistante;

  const bilan = { ajoutes: {}, modifies: {}, supprimes: {}, gardes: {}, conflitsScenes: 0, conflitsFiches: 0, recuperes: 0 };
  for (const nom of MAGASINS_SUIVIS) { bilan.ajoutes[nom] = 0; bilan.modifies[nom] = 0; bilan.supprimes[nom] = 0; bilan.gardes[nom] = 0; }

  // Les faire-part de suppression des deux côtés (on garde la date la plus récente)
  const tombes = new Map();
  for (const r of [...(local.reglages || []), ...(distant.reglages || [])]) {
    if (typeof r.cle === "string" && r.cle.startsWith(PREFIXE_SUPPRESSION) && Number.isFinite(r.valeur)) {
      tombes.set(r.cle, Math.max(tombes.get(r.cle) || 0, r.valeur));
    }
  }
  const tombe = (nom, id) => tombes.get(`${PREFIXE_SUPPRESSION}${nom}:${id}`) || 0;

  const parId = (liste) => new Map((liste || []).map((e) => [e.id, e]));
  const resultat = {};
  const sources = {}; // les versions des deux côtés, pour récupérer un parent manquant

  for (const nom of MAGASINS_SUIVIS) {
    const L = parId(local[nom]), D = parId(distant[nom]);
    const ignores = GROUPES[nom].ignores;
    sources[nom] = { L, D };
    const final = new Map();
    for (const id of new Set([...L.keys(), ...D.keys()])) {
      const l = L.get(id), d = D.get(id);
      let choisi = l || d;
      const copies = [];
      if (l && d && !memeContenu(l, d, ignores)) {
        choisi = fusionnerParts(nom, l, d);
        if (nom === "scenes") conflitScene(l, d, choisi, copies);
        if (nom === "fiches") choisi = conflitFiche(l, d, choisi);
      }
      // Supprimé de l'un des côtés après sa dernière modification : on le retire…
      // … sauf si cette version a été écrite sur un appareil sans que celui qui l'a supprimée l'ait
      // jamais reçue (réécrite ici avant que l'autre ne la supprime, ou l'inverse) : on la garde.
      // (« maj » la rend plus récente que sa suppression : une prochaine fusion ne la supprimera plus)
      // (la date la plus récente des deux côtés : une version déjà gardée malgré une suppression,
      // lors d'une fusion précédente, le dit par sa date « maj »)
      const derniere = Math.max(dateMaj(choisi), l ? dateMaj(l) : 0, d ? dateMaj(d) : 0);
      if (derniere > dateMaj(choisi)) choisi = { ...choisi, maj: derniere };
      let gardee = false;
      if (tombe(nom, id) && tombe(nom, id) >= derniere) {
        const pasVue = (l && ecritIci(l)) || (d && ecritLaBas(d));
        if (!pasVue) {
          if (l) bilan.supprimes[nom]++;
          continue;
        }
        choisi = { ...choisi, maj: maintenant };
        gardee = true;
        bilan.gardes[nom]++;
      }
      final.set(id, choisi);
      for (const c of copies) final.set(c.id, c);
      if (gardee) continue;
      if (!l) bilan.ajoutes[nom]++;
      else if (!memeContenu(l, choisi, ignores)) bilan.modifies[nom]++;
    }
    resultat[nom] = final;
  }

  // ----- Chaque part (contenu, titre, place) vient du côté où elle est la plus récente -----
  function fusionnerParts(nom, l, d) {
    const g = GROUPES[nom];
    const contenu = dateDe(d, "texte") > dateDe(l, "texte") ? d : l;
    const e = { ...contenu, majTexte: dateDe(contenu, "texte") };
    if (contenu.origine) e.origine = contenu.origine; else delete e.origine;
    for (const part of ["titre", "place"]) {
      if (!g[part].length) continue;
      const source = dateDe(d, part) > dateDe(l, part) ? d : l;
      for (const k of g[part]) { if (source[k] === undefined) delete e[k]; else e[k] = source[k]; }
      e[CHAMP_DE_DATE[part]] = dateDe(source, part);
    }
    // (la date d'activité d'un roman : la plus récente des deux)
    if (nom === "romans") e.modifie = Math.max(l.modifie || 0, d.modifie || 0);
    e.maj = Math.max(e.majTexte, e.majTitre ?? 0, e.majPlace ?? 0);
    return e;
  }

  // ----- Scène dont le texte a été écrit des deux côtés : on garde aussi l'autre version -----
  function conflitScene(l, d, scene, copies) {
    const differents = (l.texte || "") !== (d.texte || "") || (l.notes || "") !== (d.notes || "");
    if (!differents || !ecritIci(l) || !ecritLaBas(d)) return;
    const autre = scene.texte === d.texte && scene.notes === d.notes ? l : d; // la version qui n'a pas été gardée
    const nomAutre = autre === l ? noms.local : noms.distant;
    const copie = {
      ...autre,
      id: nouvelId(autre.id),
      chapitreId: scene.chapitreId, romanId: scene.romanId, ordre: (scene.ordre || 0) + 0.5,
      titre: `${scene.titre || "Sans titre"} (autre version${nomAutre ? " : " + nomAutre : ""})`,
      modifie: maintenant, maj: maintenant, majTexte: maintenant, majTitre: maintenant, majPlace: maintenant,
    };
    if (ici) copie.origine = ici; else delete copie.origine;
    copies.push(copie);
    bilan.conflitsScenes++;
  }

  // ----- Fiche modifiée des deux côtés : l'autre version est recopiée dans ses notes -----
  function conflitFiche(l, d, fusionnee) {
    if (!ecritIci(l) || !ecritLaBas(d)) return fusionnee;
    const recente = dateDe(d, "texte") > dateDe(l, "texte") ? d : l, autre = recente === l ? d : l;
    const fiche = { ...fusionnee, champs: { ...(fusionnee.champs || {}) } };
    // Les liens d'un événement (personnages, lieux) des deux versions sont gardés
    for (const lien of ["personnages", "lieux"]) {
      const tous = [...(recente.champs?.[lien] || []), ...(autre.champs?.[lien] || [])];
      if (tous.length) fiche.champs[lien] = [...new Set(tous)];
    }
    const differences = [];
    for (const cle of ["titre", "type"]) {
      if ((autre[cle] || "") !== (recente[cle] || "") && (autre[cle] || "").trim()) differences.push(`${LIBELLES[cle]} : ${autre[cle]}`);
    }
    for (const [cle, valeur] of Object.entries(autre.champs || {})) {
      if (typeof valeur === "string" && valeur.trim() && valeur !== (recente.champs?.[cle] || "")) {
        differences.push(`${LIBELLES[cle] || cle} : ${valeur}`);
      }
    }
    if ((autre.notes || "").trim() && autre.notes !== recente.notes && !(recente.notes || "").includes(autre.notes)) {
      differences.push(`${LIBELLES.notes} : ${autre.notes}`);
    }
    if (differences.length) {
      const nomAutre = autre === l ? noms.local : noms.distant;
      const entete = `— Autre version${nomAutre ? " (" + nomAutre + ")" : ""}, gardée lors de la fusion —`;
      fiche.notes = [(recente.notes || "").trimEnd(), entete, ...differences].filter(Boolean).join("\n");
      bilan.conflitsFiches++;
    }
    if (!memeContenu(fiche, fusionnee)) { // (la version réunie part aussi vers l'autre appareil)
      fiche.majTexte = maintenant;
      fiche.maj = Math.max(maintenant, fiche.majPlace ?? 0);
      if (ici) fiche.origine = ici;
    }
    return fiche;
  }

  // ----- Tout élément gardé doit avoir son roman (et une scène son chapitre) -----
  // Un parent supprimé d'un côté alors qu'un de ses éléments a été modifié de l'autre est récupéré.
  function assurer(nom, id, romanId) {
    if (resultat[nom].has(id)) return;
    const candidats = [sources[nom].L.get(id), sources[nom].D.get(id)].filter(Boolean);
    let parent = candidats.sort((a, b) => dateMaj(b) - dateMaj(a))[0];
    parent = parent
      ? { ...parent, maj: maintenant, majTexte: maintenant }   // plus récent que sa suppression : il ne disparaîtra plus
      : nom === "romans"
        ? { id, titre: "Roman récupéré", univers: "autre", cree: maintenant, modifie: maintenant, maj: maintenant, majTexte: maintenant }
        : { id, romanId, titre: "Chapitre récupéré", ordre: 9999, maj: maintenant, majTexte: maintenant };
    resultat[nom].set(id, parent);
    bilan.recuperes++;
    if (nom === "chapitres") assurer("romans", parent.romanId);
  }
  for (const c of resultat.chapitres.values()) assurer("romans", c.romanId);
  for (const s of resultat.scenes.values()) { assurer("chapitres", s.chapitreId, s.romanId); assurer("romans", s.romanId); }
  for (const f of resultat.fiches.values()) assurer("romans", f.romanId);

  const donnees = {};
  for (const nom of MAGASINS_SUIVIS) donnees[nom] = [...resultat[nom].values()];
  return {
    donnees,
    tombes: [...tombes].map(([cle, valeur]) => ({ cle, valeur })),
    bilan,
  };
}

// Un identifiant neuf pour la copie d'une scène
function nouvelId(base) {
  return base + "-v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Rien ne changerait ?
export function bilanVide(bilan) {
  const somme = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return !somme(bilan.ajoutes) && !somme(bilan.modifies) && !somme(bilan.supprimes) && !somme(bilan.gardes)
    && !bilan.recuperes && !bilan.conflitsScenes && !bilan.conflitsFiches;
}
