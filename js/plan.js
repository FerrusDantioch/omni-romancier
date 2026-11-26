// =====================================================================
// PLAN DU ROMAN (colonne de gauche) : chapitres → scènes
// Ajouter, renommer, réordonner (flèches ↑ ↓), supprimer avec confirmation.
// =====================================================================

import * as db from "./db.js";
import {
  el, nouvelId, nombre, pluriel, MODES_ROMAN, modeDuRoman, estModeLibre, themeDuRoman, ecrireTexte, majInertVolets,
} from "./outils.js";
import { ouvrirDialogue, confirmer, informer } from "./dialogues.js";
import {
  etat, chapitresTries, scenesDe, trouverScene, trouverChapitre, scenesDansLOrdre,
  motsScene, motsChapitre, motsRoman, oublierScene, annoncer,
} from "./etat.js";
import { basculerVolet } from "./panneau.js";

let ajoutEnCours = false; // évite deux scènes identiques sur un double-clic
let declencheurPlan = null; // élément à refocaliser quand le volet Plan se referme

function basculerPlan(forcer) {
  const vue = document.getElementById("vue-roman");
  const plan = document.getElementById("plan");
  const etaitOuvert = vue.classList.contains("plan-ouvert");
  const ouvert = vue.classList.toggle("plan-ouvert", forcer);
  if (ouvert) vue.classList.remove("panneau-ouvert"); // un seul volet à la fois
  document.getElementById("bouton-plan").setAttribute("aria-expanded", String(ouvert));
  majInertVolets();
  if (ouvert && !etaitOuvert && getComputedStyle(plan).position === "fixed") {
    declencheurPlan = document.activeElement;
    const cible = plan.querySelector('.plan-ouvrir[aria-current="true"], .retour, button, a');
    if (cible) cible.focus({ preventScroll: true });
  } else if (!ouvert && etaitOuvert) {
    if (declencheurPlan?.isConnected && !plan.contains(declencheurPlan)) {
      declencheurPlan.focus({ preventScroll: true });
    }
    declencheurPlan = null;
  }
  return ouvert;
}

export function initialiserPlan() {
  document.getElementById("bouton-ajout-chapitre").addEventListener("click", ajouterChapitre);
  document.getElementById("bouton-synopsis").addEventListener("click", ouvrirSynopsis);
  // Un seul « écouteur » pour tous les boutons du plan (data-action="...")
  document.getElementById("plan-liste").addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-action]");
    if (!bouton) return;
    const { action, type, id } = bouton.dataset;
    if (action === "ouvrir") ouvrirScene(id);
    else if (action === "monter") deplacer(type, id, -1);
    else if (action === "descendre") deplacer(type, id, +1);
    else if (action === "renommer") renommer(type, id);
    else if (action === "supprimer") supprimer(type, id);
    else if (action === "ajout-scene") ajouterScene(id);
  });
  // Petit écran : le bouton « Plan » ouvre / ferme la colonne
  const vue = document.getElementById("vue-roman");
  // Les boutons « ☰ Plan » et « Fiches » disent si leur volet est ouvert (lecteurs d'écran),
  // quelle que soit la façon dont il s'ouvre ou se ferme
  const majAriaVolets = () => {
    document.getElementById("bouton-plan").setAttribute("aria-expanded", String(vue.classList.contains("plan-ouvert")));
    const volet = matchMedia("(max-width: 1100px)").matches;
    const fichesVisibles = volet ? vue.classList.contains("panneau-ouvert") : !vue.classList.contains("panneau-masque");
    document.getElementById("bouton-fiches").setAttribute("aria-expanded", String(fichesVisibles));
    majInertVolets();
  };
  new MutationObserver(majAriaVolets).observe(vue, { attributes: true, attributeFilter: ["class", "hidden"] });
  window.addEventListener("resize", majAriaVolets);
  document.getElementById("bouton-plan").addEventListener("click", () => basculerPlan());
  // Toucher le voile sombre (à côté d'un volet) referme les volets ; Échap referme le plan
  vue.addEventListener("click", (e) => {
    if (e.target !== vue) return;
    if (vue.classList.contains("panneau-ouvert")) basculerVolet(false);
    if (vue.classList.contains("plan-ouvert")) basculerPlan(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && vue.classList.contains("plan-ouvert") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      basculerPlan(false);
      if (!document.activeElement || document.activeElement === document.body) {
        document.getElementById("bouton-plan").focus();
      }
    }
  });
}

// ---------- Affichage ----------

export function afficherPlan() {
  const roman = etat.roman;
  const mode = modeDuRoman(roman);
  const libre = estModeLibre(roman);
  const theme = themeDuRoman(roman);
  document.getElementById("titre-roman").textContent = roman.titre;
  document.getElementById("univers-roman").textContent = theme.nom;
  const badgeMode = document.getElementById("mode-roman");
  if (badgeMode) {
    badgeMode.textContent = MODES_ROMAN[mode].badge;
    badgeMode.className = "badge-mode badge-mode-" + mode;
  }
  const boutonSynopsis = document.getElementById("bouton-synopsis");
  if (boutonSynopsis) boutonSynopsis.hidden = !libre && !(roman.synopsis || "").trim();
  const boutonFrise = document.getElementById("bouton-frise");
  if (boutonFrise) boutonFrise.textContent = libre ? "Frise de l'intrigue" : "Frise des événements";
  majTotal();

  const liste = document.getElementById("plan-liste");
  const chapitres = chapitresTries();
  liste.replaceChildren();
  if (chapitres.length === 0) {
    liste.append(el("p", { class: "discret petit" }, "Aucun chapitre pour l'instant."));
    return;
  }
  const ol = el("ol", { class: "plan-chapitres" });
  chapitres.forEach((c, i) => {
    const scenes = scenesDe(c.id);
    ol.append(el("li", { class: "plan-chapitre", "data-id": c.id },
      el("div", { class: "plan-ligne chapitre-ligne" },
        el("span", { class: "plan-titre" }, c.titre),
        el("span", { class: "plan-mots mono", "data-mots-chapitre": c.id, title: "mots" }, nombre(motsChapitre(c.id))),
        actions("chapitre", c.id, c.titre, i === 0, i === chapitres.length - 1),
      ),
      el("ol", { class: "plan-scenes" },
        scenes.map((s, j) => {
          const premiere = i === 0 && j === 0;
          const derniere = i === chapitres.length - 1 && j === scenes.length - 1;
          return el("li", { class: "plan-scene" + (s.id === etat.sceneId ? " active" : ""), "data-id": s.id },
            el("button", { class: "plan-ouvrir", type: "button", "data-action": "ouvrir", "data-id": s.id,
              "aria-current": s.id === etat.sceneId ? "true" : false },
              el("span", { class: "plan-titre" }, s.titre || "Sans titre"),
              s.mode === "notes" ? el("span", { class: "plan-mode", title: "En mode Notes" }, "notes") : null,
            ),
            el("span", { class: "plan-mots mono", "data-mots-scene": s.id }, nombre(motsScene(s.id))),
            actions("scene", s.id, s.titre, premiere, derniere),
          );
        }),
      ),
      el("button", { class: "ajout-scene", type: "button", "data-action": "ajout-scene", "data-id": c.id }, "+ Scène"),
    ));
  });
  liste.append(ol);
}

// Les petits boutons ↑ ↓ ✎ ✕ d'une ligne
function actions(type, id, titre, premier, dernier) {
  const nomType = type === "chapitre" ? "le chapitre" : "la scène";
  const bouton = (action, symbole, libelle, inactif = false) =>
    el("button", { type: "button", class: "plan-action" + (action === "supprimer" ? " danger" : ""),
      "data-action": action, "data-type": type, "data-id": id,
      "aria-label": `${libelle} ${nomType} « ${titre} »`, title: libelle, disabled: inactif }, symbole);
  return el("span", { class: "plan-actions" },
    bouton("monter", "↑", "Monter", premier),
    bouton("descendre", "↓", "Descendre", dernier),
    bouton("renommer", "✎", "Renommer"),
    bouton("supprimer", "✕", "Supprimer"),
  );
}

// Met à jour seulement les nombres de mots (appelé pendant qu'on écrit)
export function majComptes(sceneId) {
  const s = trouverScene(sceneId);
  if (!s) return;
  const zoneScene = document.querySelector(`[data-mots-scene="${CSS.escape(sceneId)}"]`);
  if (zoneScene) ecrireTexte(zoneScene, nombre(motsScene(sceneId)));
  const zoneChapitre = document.querySelector(`[data-mots-chapitre="${CSS.escape(s.chapitreId)}"]`);
  if (zoneChapitre) ecrireTexte(zoneChapitre, nombre(motsChapitre(s.chapitreId)));
  majTotal();
}
function majTotal() {
  ecrireTexte(document.getElementById("mots-roman"), pluriel(motsRoman(), "mot"));
}

// Met en évidence la scène ouverte
export function marquerActive(sceneId) {
  document.querySelectorAll(".plan-scene").forEach((li) => {
    const active = li.dataset.id === sceneId;
    li.classList.toggle("active", active);
    const b = li.querySelector(".plan-ouvrir");
    if (active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
}

function ouvrirScene(id) {
  declencheurPlan = null; // le focus ira dans le texte de la scène
  basculerPlan(false); // petit écran : referme le plan
  annoncer("ouvrir-scene", id);
}

// ---------- Création ----------

// Renvoie le titre saisi, ou null si l'on a annulé
async function demanderTitre(titreFenetre, valeur, ok) {
  const reponse = await ouvrirDialogue({
    titre: titreFenetre,
    corps: el("label", { class: "champ" },
      el("span", { class: "etiquette" }, "Titre"),
      el("input", { type: "text", name: "titre", value: valeur, maxlength: 200, autocomplete: "off" }),
    ),
    ok,
    lireFormulaire: (form) => {
      const titre = form.elements.titre.value.trim();
      return titre ? { titre } : "Le titre ne peut pas être vide."; // un texte seul = message d'erreur
    },
  });
  return reponse ? reponse.titre : null;
}

function prochainOrdre(liste) {
  return liste.length ? Math.max(...liste.map((x) => x.ordre)) + 1 : 0;
}

// Nouveau chapitre (avec une première scène, prête à écrire)
export async function ajouterChapitre() {
  const titre = await demanderTitre("Nouveau chapitre", "Chapitre " + (etat.chapitres.length + 1), "Créer");
  if (!titre) return;
  const romanId = etat.roman.id;
  const chapitre = { id: nouvelId(), romanId, titre, ordre: prochainOrdre(etat.chapitres) };
  const scene = nouvelleScene(chapitre.id, "Scène 1", 0);
  await db.lot({ ecrire: { chapitres: [chapitre], scenes: [scene] } });
  etat.chapitres.push(chapitre);
  etat.scenes.push(scene);
  await apresChangement();
  await annoncer("ouvrir-scene", scene.id);
  annoncer("scene-creee", scene.id);
}

export async function ajouterScene(chapitreId) {
  if (ajoutEnCours) return;
  ajoutEnCours = true;
  try {
    const soeurs = scenesDe(chapitreId);
    const scene = nouvelleScene(chapitreId, "Scène " + (soeurs.length + 1), prochainOrdre(soeurs));
    await db.ecrire("scenes", scene);
    etat.scenes.push(scene);
    await apresChangement();
    await annoncer("ouvrir-scene", scene.id);
    annoncer("scene-creee", scene.id);
  } finally {
    ajoutEnCours = false;
  }
}

function nouvelleScene(chapitreId, titre, ordre) {
  return {
    id: nouvelId(), romanId: etat.roman.id, chapitreId, titre, ordre,
    notes: "", texte: "", mode: "notes", modifie: Date.now(),
  };
}

// ---------- Renommer ----------

async function renommer(type, id) {
  const objet = type === "chapitre" ? trouverChapitre(id) : trouverScene(id);
  if (!objet) return;
  const titre = await demanderTitre(type === "chapitre" ? "Renommer le chapitre" : "Renommer la scène", objet.titre, "Enregistrer");
  if (!titre) return;
  objet.titre = titre;
  // (sa date ne change pas : renommer n'est pas réécrire le texte, la fusion entre appareils ne les confond pas ;
  // une éventuelle copie de secours prend le nouveau titre : voir surRenommage dans editeur.js)
  await db.ecrire(type === "chapitre" ? "chapitres" : "scenes", objet);
  await apresChangement();
  if (type === "scene") annoncer("scene-renommee", id);
  remettreLeClavier(id, "renommer");
}

// Après une action, le clavier revient sur le même bouton (le plan a été redessiné)
// ou, s'il est devenu inactif (scène arrivée en haut), sur son voisin.
function remettreLeClavier(id, action, secours) {
  const bouton = (a) => document.querySelector(`.plan-action[data-id="${CSS.escape(id)}"][data-action="${a}"]`);
  const cible = [bouton(action), secours && bouton(secours)].find((b) => b && !b.disabled);
  if (cible) cible.focus();
}

// ---------- Réordonner ----------

// Redonne des numéros d'ordre 0, 1, 2… à une liste
function renumeroter(liste) {
  liste.forEach((x, i) => { x.ordre = i; });
  return liste;
}

async function deplacer(type, id, sens) {
  if (type === "chapitre") {
    const liste = chapitresTries();
    const i = liste.findIndex((c) => c.id === id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    await db.lot({ ecrire: { chapitres: renumeroter(liste) } });
  } else {
    const scene = trouverScene(id);
    if (!scene) return;
    const chapitres = chapitresTries();
    const ci = chapitres.findIndex((c) => c.id === scene.chapitreId);
    const soeurs = scenesDe(scene.chapitreId);
    const i = soeurs.findIndex((s) => s.id === id);
    const j = i + sens;
    if (j >= 0 && j < soeurs.length) {
      // Déplacement à l'intérieur du chapitre
      [soeurs[i], soeurs[j]] = [soeurs[j], soeurs[i]];
      await db.lot({ ecrire: { scenes: renumeroter(soeurs) } });
    } else {
      // Bord du chapitre : la scène passe dans le chapitre voisin
      const voisin = chapitres[ci + sens];
      if (!voisin) return;
      soeurs.splice(i, 1);
      const nouvellesSoeurs = scenesDe(voisin.id);
      if (sens < 0) nouvellesSoeurs.push(scene);    // à la fin du chapitre précédent
      else nouvellesSoeurs.unshift(scene);          // au début du chapitre suivant
      scene.chapitreId = voisin.id;
      await db.lot({ ecrire: { scenes: [...renumeroter(soeurs), ...renumeroter(nouvellesSoeurs)] } });
      informer(`Scène déplacée dans « ${voisin.titre} ».`);
    }
  }
  await apresChangement();
  // Garde le clavier sur le même bouton, pour pouvoir appuyer plusieurs fois de suite
  remettreLeClavier(id, sens < 0 ? "monter" : "descendre", sens < 0 ? "descendre" : "monter");
}

// La scène à ouvrir si celles de « ids » disparaissent : la suivante, sinon la précédente
function voisineDe(ids) {
  const ordre = scenesDansLOrdre();
  const indices = ordre.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
  if (!indices.length) return null;
  const apres = ordre[Math.max(...indices) + 1];
  const avant = ordre[Math.min(...indices) - 1];
  return (apres || avant || null)?.id ?? null;
}

// ---------- Supprimer ----------

async function supprimer(type, id) {
  let voisine = null;
  if (type === "chapitre") {
    const chapitre = trouverChapitre(id);
    if (!chapitre) return;
    const scenes = scenesDe(id);
    const ok = await confirmer({
      titre: "Supprimer ce chapitre ?",
      message: [
        `« ${chapitre.titre} » sera supprimé avec ${pluriel(scenes.length, "scène")} (${pluriel(motsChapitre(id), "mot rédigé", "mots rédigés")}, plus les notes).`,
        "Cette action ne peut pas être annulée.",
      ],
      ok: "Supprimer définitivement",
      danger: true,
    });
    if (!ok) return;
    const idsSupprimes = scenes.map((s) => s.id);
    voisine = voisineDe(idsSupprimes);
    // D'abord on retire de la mémoire (une sauvegarde automatique en cours ne pourra plus les réécrire),
    // ensuite on efface de la base
    etat.chapitres = etat.chapitres.filter((c) => c.id !== id);
    for (const s of scenes) oublierScene(s.id);
    etat.scenes = etat.scenes.filter((s) => s.chapitreId !== id);
    await db.lot({ supprimer: { chapitres: [id], scenes: idsSupprimes } });
    informer(`« ${chapitre.titre} » a été supprimé.`);
    await apresChangement();
    await annoncer("scene-supprimee", { voisine, ids: idsSupprimes });
  } else {
    const scene = trouverScene(id);
    if (!scene) return;
    const ok = await confirmer({
      titre: "Supprimer cette scène ?",
      message: [
        `« ${scene.titre} » sera supprimée (${pluriel(motsScene(id), "mot rédigé", "mots rédigés")}, plus les notes).`,
        "Cette action ne peut pas être annulée.",
      ],
      ok: "Supprimer définitivement",
      danger: true,
    });
    if (!ok) return;
    voisine = voisineDe([id]);
    oublierScene(id);
    etat.scenes = etat.scenes.filter((s) => s.id !== id);
    await db.supprimer("scenes", id);
    informer(`« ${scene.titre} » a été supprimée.`);
    await apresChangement();
    await annoncer("scene-supprimee", { voisine, ids: [id] });
  }
  // Le plan a été redessiné : si le clavier s'est perdu, il revient sur la scène voisine (ou « + Chapitre »)
  if (document.activeElement === document.body || !document.activeElement) {
    const cible = (voisine && document.querySelector(`.plan-ouvrir[data-id="${CSS.escape(voisine)}"]`))
      || document.getElementById("bouton-ajout-chapitre");
    cible.focus({ preventScroll: true });
  }
}

// Après chaque changement de structure : date de modification du roman + nouvel affichage
async function apresChangement() {
  etat.roman.modifie = Date.now();
  await db.ecrire("romans", etat.roman);
  afficherPlan();
  annoncer("plan-change");
}

// Consulter et modifier le synopsis / pitch du roman
async function ouvrirSynopsis() {
  if (!etat.roman) return;
  const reponse = await ouvrirDialogue({
    titre: "Synopsis du roman",
    corps: [
      el("label", { class: "champ" },
        el("span", { class: "etiquette" }, "Synopsis / Pitch"),
        el("textarea", {
          name: "synopsis", rows: 6, maxlength: 2000, lang: "fr", spellcheck: "true",
          placeholder: "Résume l'idée directrice, l'enjeu ou la trame du roman…",
        }, etat.roman.synopsis || ""),
      ),
      el("p", { class: "discret petit" }, "Affiché dans la bibliothèque et ajouté au début de l'annexe des fiches à l'export."),
    ],
    ok: "Enregistrer",
    lireFormulaire: (form) => ({ synopsis: (form.elements.synopsis.value || "").trim() }),
  });
  if (!reponse) return;
  etat.roman.synopsis = reponse.synopsis;
  etat.roman.modifie = Date.now();
  await db.ecrire("romans", etat.roman);
  const boutonSynopsis = document.getElementById("bouton-synopsis");
  if (boutonSynopsis) boutonSynopsis.hidden = !estModeLibre(etat.roman) && !etat.roman.synopsis;
  informer("Synopsis enregistré.");
}
