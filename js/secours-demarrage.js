// =====================================================================
// SECOURS AU DÉMARRAGE (extrait hors de index.html pour respecter la CSP)
// Si l'application ne peut pas démarrer, on l'explique au lieu
// d'afficher des boutons qui ne répondent pas.
// =====================================================================
(function () {
  "use strict";

  function alerteDemarrage(detail) {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var raison = location.protocol === "file:"
      ? "La page a été ouverte directement (double-clic sur index.html). Elle doit passer par le petit serveur : "
        + "suis l'étape B du fichier LISEZ-MOI.md, puis ouvre l'adresse http://localhost:8000"
      : local
        ? "Recharge la page. Si le problème continue, arrête le petit serveur et lance-le avec « py serveur.py » "
          + "(Mac : « python3 serveur.py »), ou utilise une version à jour de Chrome ou d'Edge."
        : "Recharge la page, avec une connexion à Internet si possible (une mise à jour d'Omni-Romancier était "
          + "peut-être en cours). Si le problème continue, utilise une version à jour de Chrome ou d'Edge.";
    var elRaison = document.getElementById("alerte-raison");
    var elAlerte = document.getElementById("alerte-demarrage");
    var elMain = document.querySelector("main");
    if (elRaison) elRaison.textContent = raison + (detail ? " (détail : " + detail + ")" : "");
    if (elAlerte) elAlerte.hidden = false;
    if (elMain) elMain.hidden = true;
  }

  window.alerteDemarrage = alerteDemarrage;

  // Renseigne la version affichée dans « À propos » depuis CONFIG_APP
  var elVersion = document.getElementById("apropos-version");
  if (elVersion && window.CONFIG_APP && window.CONFIG_APP.version) {
    elVersion.textContent = window.CONFIG_APP.version;
  }

  // Un fichier de l'application refuse de se charger avec les autres (ex. échec du module principal) :
  // l'écouteur en phase de capture intercepte aussi les erreurs de chargement <script>.
  window.addEventListener("error", function (e) {
    var alerte = document.getElementById("alerte-demarrage");
    if (!window.applicationChargee && alerte && alerte.hidden) {
      alerteDemarrage(e && e.message);
    }
  }, true);
}());
