// =====================================================================
// BIBLIOTHÈQUE : la liste des romans (créer, modifier, supprimer)
// =====================================================================

import * as db from "./db.js";
import { UNIVERS, el, nouvelId, compterMots, pluriel, ilYa } from "./outils.js";
import { ouvrirDialogue, confirmer, informer } from "./dialogues.js";
import { effacerSecoursDe } from "./editeur.js";

// Appelé après chaque changement (pour mettre à jour le rappel de sauvegarde, etc.)
let apresChangement = () => {};

export function initialiserBibliotheque({ quandCaChange }) {
  apresChangement = quandCaChange;
  document.getElementById("bouton-nouveau-roman").addEventListener("click", creerRoman);
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

  liste.replaceChildren();
  if (romans.length === 0) {
    liste.append(el("div", { class: "vide" },
      el("p", {}, "Aucun roman pour l'instant."),
      el("p", { class: "discret" }, "Crée ton premier roman pour commencer à écrire."),
      el("button", { class: "bouton", type: "button", onclick: creerRoman }, "Créer un roman"),
    ));
    return;
  }

  for (const roman of romans) {
    const sesChapitres = chapitres.filter((c) => c.romanId === roman.id);
    const sesScenes = scenes.filter((s) => s.romanId === roman.id);
    const mots = sesScenes.reduce((total, s) => total + compterMots(s.texte), 0);
    liste.append(carteRoman(roman, sesChapitres.length, sesScenes.length, mots));
  }
}

// Fabrique la carte d'un roman
function carteRoman(roman, nbChapitres, nbScenes, nbMots) {
  const univers = UNIVERS[roman.univers] ? roman.univers : "autre";
  return el("article", { class: "carte roman-carte " + univers, "data-id": roman.id },
    el("span", { class: "statut", style: { "justify-self": "start" } }, UNIVERS[univers].nom),
    el("h2", {},
      el("a", { href: "#roman/" + encodeURIComponent(roman.id), class: "titre-roman" }, roman.titre),
    ),
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

// Le contenu du formulaire : titre + choix de l'univers
function champsRoman(roman) {
  const universActuel = roman ? roman.univers : "fantasy";
  return [
    el("label", { class: "champ" },
      el("span", { class: "etiquette" }, "Titre du roman"),
      el("input", { type: "text", name: "titre", value: roman ? roman.titre : "", maxlength: 200, required: true, autocomplete: "off" }),
    ),
    el("fieldset", { class: "choix-univers" },
      el("legend", { class: "etiquette" }, "Univers"),
      Object.entries(UNIVERS).map(([cle, u]) =>
        el("label", { class: "option-univers " + cle },
          el("input", { type: "radio", name: "univers", value: cle, checked: cle === universActuel }),
          el("span", {}, u.nom),
        ),
      ),
    ),
  ];
}

// Lit et vérifie le formulaire. Renvoie les valeurs, ou un message d'erreur.
function lireRoman(form) {
  const titre = form.elements.titre.value.trim();
  const univers = form.elements.univers.value;
  if (!titre) return "Donne un titre à ton roman.";
  if (!UNIVERS[univers]) return "Choisis un univers.";
  return { titre, univers };
}

export async function creerRoman() {
  const valeurs = await ouvrirDialogue({
    titre: "Nouveau roman",
    corps: champsRoman(null),
    ok: "Créer",
    lireFormulaire: lireRoman,
  });
  if (!valeurs) return; // annulé
  const maintenant = Date.now();
  const roman = { id: nouvelId(), titre: valeurs.titre, univers: valeurs.univers, cree: maintenant, modifie: maintenant };
  await db.ecrire("romans", roman);
  informer(`« ${roman.titre} » a été créé.`);
  await afficherBibliotheque();
  apresChangement();
}

export async function modifierRoman(roman) {
  const valeurs = await ouvrirDialogue({
    titre: "Modifier le roman",
    corps: champsRoman(roman),
    ok: "Enregistrer",
    lireFormulaire: lireRoman,
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
