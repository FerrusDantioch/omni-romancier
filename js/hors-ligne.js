// =====================================================================
// HORS LIGNE, MISES À JOUR ET INSTALLATION
// - enregistre le service worker (./sw.js) : l'application fonctionne hors ligne ;
// - propose « Mettre à jour » dès qu'une nouvelle version est en attente
//   (rien ne change par surprise tant que tu ne cliques pas) ;
// - propose d'installer Omni-Romancier comme une application.
// =====================================================================

import { informer } from "./dialogues.js";
import { sauverMaintenant } from "./editeur.js";
import { sauverFiche } from "./panneau.js";
import { ecrireTexte } from "./outils.js";

const COOLDOWN_VERIF_MS = 5 * 60 * 1000;

let invitation = null; // proposition d'installation du navigateur
let inscription = null;
let derniereVerif = 0;
let dejaControlee = false;
let rechargementEnCours = false;

const $ = (id) => document.getElementById(id);

export function initialiserHorsLigne() {
  dejaControlee = "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);

  activer();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    invitation = e;
    majInstallation();
  });
  window.addEventListener("appinstalled", () => {
    invitation = null;
    majInstallation();
    informer("Omni-Romancier est installé : tu le retrouveras parmi tes applications.");
  });

  const boutonInstaller = $("bouton-installer");
  if (boutonInstaller) boutonInstaller.addEventListener("click", installer);

  const boutonMaj = $("bouton-mise-a-jour");
  if (boutonMaj) boutonMaj.addEventListener("click", mettreAJour);

  const boutonVerifier = $("bouton-verifier-maj");
  if (boutonVerifier) boutonVerifier.addEventListener("click", () => verifierManuellement(boutonVerifier));

  majInstallation();
}

function ecrireEtat(texte) {
  const zone = $("etat-hors-ligne");
  if (zone) ecrireTexte(zone, texte);
}

function afficherMiseAJourPrete() {
  const bandeau = $("bandeau-mise-a-jour");
  if (bandeau) bandeau.hidden = false;
  ecrireEtat("Une nouvelle version est prête ! Clique sur « Mettre à jour ».");
}

function suivreInstallation(worker, reg) {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      afficherMiseAJourPrete();
    } else if (worker.state === "activated" && !reg.waiting) {
      ecrireEtat("Prête à fonctionner sans connexion ✓");
    }
  });
}

async function activer() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) {
    ecrireEtat("Mode hors ligne indisponible ici.");
    return;
  }

  // Recharge tous les onglets ouverts lors d'une mise à jour (jamais à la toute première installation)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!dejaControlee) {
      dejaControlee = true;
      return;
    }
    if (rechargementEnCours) return;
    rechargementEnCours = true;
    location.reload();
  });

  ecrireEtat("Mise en réserve pour le mode hors ligne…");
  try {
    inscription = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
      updateViaCache: "none",
    });
    derniereVerif = Date.now();

    if (inscription.waiting) {
      afficherMiseAJourPrete();
    } else if (inscription.installing) {
      suivreInstallation(inscription.installing, inscription);
    }

    inscription.addEventListener("updatefound", () => {
      suivreInstallation(inscription.installing, inscription);
    });

    await sansTropAttendre(navigator.serviceWorker.ready, 30000);
    if (inscription.waiting) {
      afficherMiseAJourPrete();
    } else {
      ecrireEtat("Prête à fonctionner sans connexion ✓");
    }

    // Vérifications discrètes au retour sur l'onglet (cooldown 5 min) et au retour du réseau
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        verifierSilencieusement();
      }
    });
    window.addEventListener("online", () => {
      derniereVerif = Date.now();
      inscription.update().catch(() => {});
    });
  } catch (erreur) {
    ecrireEtat("⚠ Le mode hors ligne n'a pas pu s'activer (" + erreur.message + "). Rouvre Omni-Romancier pour réessayer.");
  }
}

function verifierSilencieusement() {
  if (!inscription || !navigator.onLine) return;
  const maintenant = Date.now();
  if (maintenant - derniereVerif < COOLDOWN_VERIF_MS) return;
  derniereVerif = maintenant;
  inscription.update().catch(() => {});
}

async function verifierManuellement(bouton) {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) {
    ecrireEtat("Mode hors ligne indisponible ici.");
    return;
  }
  if (!navigator.onLine) {
    ecrireEtat("Tu es hors ligne : reconnecte-toi pour vérifier les mises à jour.");
    return;
  }
  if (!inscription) {
    ecrireEtat("Service worker non initialisé. Recharge la page pour réessayer.");
    return;
  }

  bouton.disabled = true;
  ecrireEtat("Vérification des mises à jour…");
  try {
    derniereVerif = Date.now();
    await inscription.update();
    if (inscription.waiting) {
      afficherMiseAJourPrete();
    } else if (inscription.installing) {
      ecrireEtat("Téléchargement de la nouvelle version en cours…");
    } else {
      ecrireEtat("Tu as déjà la dernière version ✓");
    }
  } catch (erreur) {
    ecrireEtat("Impossible de vérifier les mises à jour (" + erreur.message + "). Réessaie plus tard.");
  } finally {
    bouton.disabled = false;
  }
}

// « Mettre à jour » : on enregistre le texte et la fiche en cours avant d'activer le nouveau worker
async function mettreAJour() {
  const bouton = $("bouton-mise-a-jour");
  if (bouton) bouton.disabled = true;
  try {
    await sauverMaintenant();
    await sauverFiche();
    const reg = inscription || await navigator.serviceWorker.getRegistration("./");
    const enAttente = reg && reg.waiting;
    if (!enAttente) {
      location.reload();
      return;
    }
    dejaControlee = true;
    enAttente.postMessage("activer");
  } catch (erreur) {
    if (bouton) bouton.disabled = false;
    informer("La mise à jour n'a pas pu se faire (" + erreur.message + "). Réessaie dans un instant.");
  }
}

function sansTropAttendre(promesse, ms) {
  return Promise.race([
    promesse,
    new Promise((_, echec) => setTimeout(() => echec(new Error("pas de réponse")), ms)),
  ]);
}

function majInstallation() {
  const encart = $("encart-installation");
  if (!encart) return;
  const dejaInstallee = window.matchMedia("(display-mode: standalone)").matches;
  encart.hidden = !invitation || dejaInstallee;
}

async function installer() {
  if (!invitation) return;
  const proposition = invitation;
  invitation = null;
  majInstallation();
  try {
    await proposition.prompt();
  } catch {
    informer("Utilise plutôt le menu du navigateur (⋮) → « Installer Omni-Romancier ».");
  }
}
