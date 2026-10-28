// =====================================================================
// HORS LIGNE ET INSTALLATION
// - active le service worker (sw.js) : l'application fonctionne sans connexion,
//   et même sans le petit serveur une fois qu'elle a été ouverte une première fois ;
// - propose « Mettre à jour » quand une nouvelle version est prête : elle ne remplace
//   l'ancienne qu'après cet appui (jamais par surprise) ;
// - propose d'installer Omni-Romancier comme une application (icône, fenêtre à part).
// =====================================================================

import { informer } from "./dialogues.js";
import { sauverMaintenant } from "./editeur.js";
import { ecrireTexte } from "./outils.js";

let invitation = null; // la proposition d'installation du navigateur, gardée pour notre bouton

const $ = (id) => document.getElementById(id);

export function initialiserHorsLigne() {
  activer();

  // Le navigateur est prêt à installer l'application : on affiche notre bouton
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    invitation = e;
    majInstallation();
  });
  window.addEventListener("appinstalled", () => {
    invitation = null;
    majInstallation();
    informer("Omni-Romancier est installé : vous le retrouverez parmi vos applications.");
  });
  $("bouton-installer").addEventListener("click", installer);
  $("bouton-mise-a-jour").addEventListener("click", mettreAJour);
  majInstallation();
}

// Active le mode hors ligne, vérifie la copie en réserve, et dit dans « À propos » où l'on en est
async function activer() {
  const ecrire = (texte) => ecrireTexte($("etat-hors-ligne"), texte); // (sans rien retirer de la page : voir outils.js)
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) {
    ecrire("Mode hors ligne indisponible ici.");
    return;
  }
  ecrire("Mise en réserve pour le mode hors ligne…");
  try {
    await navigator.serviceWorker.register("sw.js");
    const inscription = await sansTropAttendre(navigator.serviceWorker.ready, 30000);
    const { complete, erreur, nouvelleVersion } = await sansTropAttendre(demander(inscription.active, "verifier"), 60000);
    // Une nouvelle version est mise de côté : on la propose, sans rien changer d'autre
    $("bandeau-mise-a-jour").hidden = !nouvelleVersion;
    if (!complete) {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      ecrire("⚠ Pas encore prête à fonctionner sans connexion : " + erreur + (local
        ? ". Gardez le serveur lancé et rouvrez Omni-Romancier (voir LISEZ-MOI.md)."
        : ". Rouvrez Omni-Romancier avec une connexion à Internet pour terminer la mise en réserve."));
    } else if (erreur && erreur !== "le serveur ne répond pas") {
      ecrire("Prête à fonctionner sans connexion ✓ (une éventuelle nouvelle version n'a pas pu être "
        + "téléchargée : " + erreur + ")");
    } else {
      ecrire("Prête à fonctionner sans connexion ✓");
    }
  } catch (erreur) {
    ecrire("⚠ Le mode hors ligne n'a pas pu s'activer (" + erreur.message + "). Rouvrez Omni-Romancier pour réessayer.");
  }
}

// « Mettre à jour » : on enregistre tout ce qui attend, puis la nouvelle version remplace
// l'ancienne dans la réserve, et la page se recharge pour l'afficher
async function mettreAJour() {
  const bouton = $("bouton-mise-a-jour");
  bouton.disabled = true;
  try {
    await sauverMaintenant();
    const inscription = await navigator.serviceWorker.ready;
    await sansTropAttendre(demander(inscription.active, "appliquer"), 60000);
    location.reload();
  } catch (erreur) {
    bouton.disabled = false;
    informer("La mise à jour n'a pas pu se faire (" + erreur.message + "). Réessayez dans un instant.");
  }
}

// Envoie une demande au service worker et attend sa réponse
function demander(travailleur, message) {
  return new Promise((ok) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = (e) => ok(e.data);
    travailleur.postMessage(message, [canal.port2]);
  });
}

function sansTropAttendre(promesse, ms) {
  return Promise.race([promesse, new Promise((_, echec) => setTimeout(() => echec(new Error("pas de réponse")), ms))]);
}

// Affiche le bouton « Installer » seulement si c'est possible (et pas déjà fait)
function majInstallation() {
  const dejaInstallee = window.matchMedia("(display-mode: standalone)").matches;
  $("encart-installation").hidden = !invitation || dejaInstallee;
}

async function installer() {
  if (!invitation) return;
  // Une proposition du navigateur ne sert qu'une fois : l'encart disparaît, et reviendra
  // de lui-même si le navigateur la propose à nouveau plus tard
  const proposition = invitation;
  invitation = null;
  majInstallation();
  try {
    await proposition.prompt();              // la fenêtre d'installation du navigateur
  } catch {
    informer("Utilisez plutôt le menu du navigateur (⋮) → « Installer Omni-Romancier ».");
  }
}
