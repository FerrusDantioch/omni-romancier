// =====================================================================
// BIBLIOTHÈQUE : la liste des romans (créer, modifier, supprimer)
// =====================================================================

import * as db from "./db.js";
import {
  MODES_ROMAN, UNIVERS, GENRES, modeDuRoman, themeDuRoman, el, nouvelId, compterMots, pluriel, ilYa,
} from "./outils.js";
import { ouvrirDialogue, confirmer, informer } from "./dialogues.js";
import { effacerSecoursDe } from "./editeur.js";

// Appelé après chaque changement (pour mettre à jour le rappel de sauvegarde, etc.)
let apresChangement = () => {};
let filtreMode = "tous";

export function initialiserBibliotheque({ quandCaChange }) {
  apresChangement = quandCaChange;
  document.getElementById("bouton-nouveau-roman").addEventListener("click", () => creerRoman());
  const barreFiltre = document.getElementById("filtre-modes");
  if (barreFiltre) {
    barreFiltre.addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-filtre]");
      if (!bouton || bouton.dataset.filtre === filtreMode) return;
      filtreMode = bouton.dataset.filtre;
      afficherBibliotheque();
    });
  }
}

// ---------- Affichage de la liste ----------

export async function afficherBibliotheque() {
  const vue = document.getElementById("vue-bibliotheque");
  if (vue) vue.hidden = false;
  const liste = document.getElementById("liste-romans");
  const [romans, chapitres, scenes] = await Promise.all([
    db.lireTout("romans"), db.lireTout("chapitres"), db.lireTout("scenes"),
  ]);

  // Le plus récemment modifié en premier
  romans.sort((a, b) => (b.modifie || 0) - (a.modifie || 0));

  const nbJdr = romans.filter((r) => modeDuRoman(r) === "jdr").length;
  const nbLibre = romans.length - nbJdr;
  majFiltreModes(romans.length, nbJdr, nbLibre);

  liste.replaceChildren();
  if (romans.length === 0) {
    liste.append(el("div", { class: "vide" },
      el("p", {}, "Aucun roman pour l'instant."),
      el("p", { class: "discret" }, "Crée ton premier roman (JDR ou hors JDR) pour commencer à écrire."),
      el("button", { class: "bouton", type: "button", onclick: () => creerRoman() }, "Créer un roman"),
    ));
    return;
  }

  const visibles = filtreMode === "tous"
    ? romans
    : romans.filter((r) => modeDuRoman(r) === filtreMode);

  if (visibles.length === 0) {
    const cible = filtreMode === "libre" ? "libre" : "jdr";
    liste.append(el("div", { class: "vide" },
      el("p", {}, cible === "libre" ? "Aucun roman libre (hors JDR) pour l'instant." : "Aucun roman JDR pour l'instant."),
      el("p", { class: "discret" }, cible === "libre"
        ? "Tu peux créer un roman indépendant du jeu de rôle, avec genre littéraire, synopsis et fiches dédiées."
        : "Tu peux créer un roman tiré d'une partie de l'Omni-système."),
      el("div", { class: "ligne" },
        el("button", { class: "bouton", type: "button", onclick: () => creerRoman(cible) },
          cible === "libre" ? "Créer un roman libre" : "Créer un roman JDR"),
        el("button", { class: "petit-bouton", type: "button", onclick: () => { filtreMode = "tous"; afficherBibliotheque(); } },
          "Voir tous les romans"),
      ),
    ));
    return;
  }

  for (const roman of visibles) {
    const sesChapitres = chapitres.filter((c) => c.romanId === roman.id);
    const sesScenes = scenes.filter((s) => s.romanId === roman.id);
    const mots = sesScenes.reduce((total, s) => total + compterMots(s.texte), 0);
    liste.append(carteRoman(roman, sesChapitres.length, sesScenes.length, mots));
  }
}

function majFiltreModes(total, nbJdr, nbLibre) {
  const barre = document.getElementById("filtre-modes");
  if (!barre) return;
  barre.hidden = total === 0;
  const comptes = { tous: total, jdr: nbJdr, libre: nbLibre };
  const libelles = { tous: "Tous", jdr: "Roman JDR", libre: "Roman libre" };
  barre.querySelectorAll("[data-filtre]").forEach((b) => {
    const cle = b.dataset.filtre;
    b.setAttribute("aria-pressed", String(cle === filtreMode));
    b.textContent = `${libelles[cle]} (${comptes[cle] ?? 0})`;
  });
}

// Fabrique la carte d'un roman
function carteRoman(roman, nbChapitres, nbScenes, nbMots) {
  const mode = modeDuRoman(roman);
  const theme = themeDuRoman(roman);
  const synopsis = (roman.synopsis || "").trim();
  return el("article", { class: "carte roman-carte " + theme.cle, "data-id": roman.id },
    el("div", { class: "roman-carte-meta" },
      el("span", { class: "statut" }, theme.nom),
      el("span", { class: "badge-mode badge-mode-" + mode }, MODES_ROMAN[mode].badge),
    ),
    el("h2", {},
      el("a", { href: "#roman/" + encodeURIComponent(roman.id), class: "titre-roman" }, roman.titre),
    ),
    synopsis ? el("p", { class: "roman-carte-synopsis" }, synopsis) : null,
    el("p", { class: "discret petit" },
      [pluriel(nbChapitres, "chapitre"), pluriel(nbScenes, "scène"), pluriel(nbMots, "mot")].join(" · "),
      el("br"),
      "Modifié " + ilYa(roman.modifie || roman.cree || Date.now()),
    ),
    el("div", { class: "ligne" },
      el("a", { class: "bouton bouton-petit", href: "#roman/" + encodeURIComponent(roman.id) }, "Ouvrir"),
      el("button", { class: "petit-bouton", type: "button", onclick: () => modifierRoman(roman) }, "Modifier"),
      el("button", { class: "petit-bouton danger", type: "button", onclick: () => supprimerAvecConfirmation(roman) }, "Supprimer"),
    ),
  );
}

// ---------- Formulaire (création et modification) ----------

// Le contenu du formulaire : titre + mode (JDR / Libre) + univers ou genre + synopsis
function champsRoman(roman, { modeParDefaut = "jdr" } = {}) {
  const modeInitial = roman ? modeDuRoman(roman) : (MODES_ROMAN[modeParDefaut] ? modeParDefaut : "jdr");
  const universActuel = UNIVERS[roman?.univers] ? roman.univers : "fantasy";
  const genreActuel = GENRES[roman?.genre] ? roman.genre : "contemporain";
  const aUnSynopsis = !!(roman?.synopsis || "").trim();

  const blocUnivers = el("fieldset", { class: "choix-univers", hidden: modeInitial !== "jdr" },
    el("legend", { class: "etiquette" }, "Univers (Omni-système)"),
    Object.entries(UNIVERS).map(([cle, u]) =>
      el("label", { class: "option-univers " + cle },
        el("input", { type: "radio", name: "univers", value: cle, checked: cle === universActuel }),
        el("span", {}, u.nom),
      ),
    ),
  );

  const blocGenre = el("fieldset", { class: "choix-univers", hidden: modeInitial !== "libre" },
    el("legend", { class: "etiquette" }, "Genre littéraire"),
    Object.entries(GENRES).map(([cle, g]) =>
      el("label", { class: "option-univers " + (cle === "autre" ? "autre" : "genre-" + cle) },
        el("input", { type: "radio", name: "genre", value: cle, checked: cle === genreActuel }),
        el("span", {}, g.nom),
      ),
    ),
  );

  const blocSynopsis = el("label", { class: "champ", hidden: modeInitial !== "libre" && !aUnSynopsis },
    el("span", { class: "etiquette" }, "Synopsis / Pitch (facultatif)"),
    el("textarea", {
      name: "synopsis", rows: 3, maxlength: 2000, lang: "fr", spellcheck: "true",
      placeholder: "En quelques lignes : de quoi parle ce roman ?",
    }, roman ? roman.synopsis || "" : ""),
  );

  const noteConversion = roman
    ? el("p", { class: "discret petit", hidden: true },
        "Changer de mode adapte le vocabulaire et les champs des fiches sans rien supprimer de tes textes ni de tes fiches existantes.")
    : null;

  const blocMode = el("fieldset", {
    class: "choix-mode",
    onchange: (e) => {
      if (e.target.name !== "mode") return;
      const libre = e.target.value === "libre";
      blocUnivers.hidden = libre;
      blocGenre.hidden = !libre;
      blocSynopsis.hidden = !libre && !aUnSynopsis;
      if (noteConversion) noteConversion.hidden = e.target.value === modeInitial;
    },
  },
    el("legend", { class: "etiquette" }, "Mode d'écriture"),
    Object.entries(MODES_ROMAN).map(([cle, m]) =>
      el("label", { class: "option-mode" },
        el("input", { type: "radio", name: "mode", value: cle, checked: cle === modeInitial }),
        el("span", { class: "option-mode-texte" },
          el("strong", {}, m.nom),
          el("small", {}, m.description),
        ),
      ),
    ),
  );

  return [
    el("label", { class: "champ" },
      el("span", { class: "etiquette" }, "Titre du roman"),
      el("input", { type: "text", name: "titre", value: roman ? roman.titre : "", maxlength: 200, required: true, autocomplete: "off" }),
    ),
    blocMode,
    blocUnivers,
    blocGenre,
    blocSynopsis,
    noteConversion,
  ];
}

// Lit et vérifie le formulaire. Renvoie les valeurs, ou un message d'erreur.
function lireRoman(form, romanExistant = null) {
  const titre = form.elements.titre.value.trim();
  const mode = form.elements.mode.value;
  if (!titre) return "Donne un titre à ton roman.";
  if (!MODES_ROMAN[mode]) return "Choisis un mode d'écriture.";
  const synopsis = (form.elements.synopsis?.value || "").trim();

  if (mode === "libre") {
    const genre = form.elements.genre.value;
    if (!GENRES[genre]) return "Choisis un genre littéraire.";
    return {
      titre,
      mode,
      genre,
      univers: romanExistant?.univers && UNIVERS[romanExistant.univers] ? romanExistant.univers : "autre",
      synopsis,
    };
  }

  const univers = form.elements.univers.value;
  if (!UNIVERS[univers]) return "Choisis un univers.";
  const resultat = { titre, mode, univers, synopsis };
  if (romanExistant?.genre && GENRES[romanExistant.genre]) resultat.genre = romanExistant.genre;
  return resultat;
}

export async function creerRoman(modeParDefaut = "jdr") {
  const modeInit = MODES_ROMAN[modeParDefaut] ? modeParDefaut : "jdr";
  const valeurs = await ouvrirDialogue({
    titre: "Nouveau roman",
    corps: champsRoman(null, { modeParDefaut: modeInit }),
    ok: "Créer",
    lireFormulaire: (form) => lireRoman(form, null),
  });
  if (!valeurs) return; // annulé
  const maintenant = Date.now();
  const roman = { id: nouvelId(), ...valeurs, cree: maintenant, modifie: maintenant };
  await db.ecrire("romans", roman);
  if (filtreMode !== "tous" && filtreMode !== roman.mode) filtreMode = "tous";
  informer(`« ${roman.titre} » a été créé.`);
  await afficherBibliotheque();
  apresChangement();
}

export async function modifierRoman(roman) {
  const valeurs = await ouvrirDialogue({
    titre: "Modifier le roman",
    corps: champsRoman(roman),
    ok: "Enregistrer",
    lireFormulaire: (form) => lireRoman(form, roman),
  });
  if (!valeurs) return;
  // On relit le roman dans la base, pour ne rien écraser d'autre
  const actuel = (await db.lire("romans", roman.id)) || roman;
  await db.ecrire("romans", { ...actuel, ...valeurs, modifie: Date.now() });
  informer("Modifications enregistrées.");
  await afficherBibliotheque();
  apresChangement();
}

async function supprimerAvecConfirmation(roman) {
  const [chapitres, scenes, fiches] = await Promise.all([
    db.lireDuRoman("chapitres", roman.id), db.lireDuRoman("scenes", roman.id), db.lireDuRoman("fiches", roman.id),
  ]);
  const ok = await confirmer({
    titre: "Supprimer ce roman ?",
    message: [
      `« ${roman.titre} » sera supprimé définitivement, avec ${pluriel(chapitres.length, "chapitre")}, ${pluriel(scenes.length, "scène")} et ${pluriel(fiches.length, "fiche")}.`,
      "Cette action ne peut pas être annulée (sauf si tu as exporté tes données avant).",
    ],
    ok: "Supprimer définitivement",
    danger: true,
  });
  if (!ok) return;
  await db.supprimerRoman(roman.id);
  effacerSecoursDe(scenes.map((s) => s.id));
  informer(`« ${roman.titre} » a été supprimé.`);
  await afficherBibliotheque();
  apresChangement();
}
