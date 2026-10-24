// =====================================================================
// L'ÉCRAN DU DICTIONNAIRE PERSONNEL
//
// Remplit un emplacement fourni par l'application (une fenêtre, en
// général) : un champ pour ajouter un mot, puis la liste des mots, chacun
// avec un bouton « Retirer ». La liste se met à jour toute seule.
// Les classes des boutons et des champs sont celles de l'application, pour
// garder son style.
// =====================================================================

/**
 * @param {HTMLElement} conteneur  l'emplacement à remplir
 * @param {ReturnType<import('./correcteur.js').creerCorrecteur>} correcteur
 * @param {object} [classes]  classes CSS de l'application
 * @param {string} [classes.bouton]  pour le bouton « Ajouter »
 * @param {string} [classes.boutonDiscret]  pour les boutons « Retirer »
 * @param {string} [classes.champ]  pour le champ de saisie
 * @returns {() => void}  à appeler quand l'écran est fermé (arrête la mise à jour)
 */
export function afficherDictionnaire(conteneur, correcteur, classes = {}) {
  const formulaire = document.createElement('form');
  formulaire.className = 'correcteur-ajout';
  const champ = document.createElement('input');
  champ.type = 'text';
  champ.className = classes.champ ?? '';
  champ.lang = 'fr';
  champ.autocomplete = 'off';
  champ.spellcheck = false;
  champ.maxLength = 80;
  champ.placeholder = 'Un mot à ajouter';
  champ.setAttribute('aria-label', 'Mot à ajouter au dictionnaire personnel');
  champ.setAttribute('enterkeyhint', 'done');
  const ajouter = document.createElement('button');
  ajouter.type = 'submit';
  ajouter.className = classes.bouton ?? '';
  ajouter.textContent = 'Ajouter';
  formulaire.append(champ, ajouter);

  const message = document.createElement('p');
  message.className = 'correcteur-message';
  message.setAttribute('role', 'status');

  const compte = document.createElement('p');
  compte.className = 'correcteur-compte';
  const liste = document.createElement('ul');
  liste.className = 'correcteur-liste';
  liste.setAttribute('aria-label', 'Mots du dictionnaire personnel');

  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const mot = champ.value.trim();
    if (!mot) return;
    if (correcteur.ajouter(mot)) {
      message.textContent = `« ${mot} » est ajouté.`;
      champ.value = '';
    } else {
      message.textContent = 'Un seul mot à la fois, sans espace (un trait d’union est permis).';
    }
    champ.focus();
  });

  liste.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mot]');
    if (!b) return;
    const mot = b.dataset.mot;
    const place = [...liste.children].indexOf(b.closest('li'));
    correcteur.retirer(mot); // (la liste est refaite aussitôt)
    message.textContent = `« ${mot} » est retiré.`;
    // Le focus passe sur le mot suivant (ou le champ) : on peut en retirer plusieurs à la suite
    const suivant = liste.children[Math.min(place, liste.children.length - 1)];
    (suivant?.querySelector('button') ?? champ).focus();
  });

  function afficher() {
    const mots = correcteur.mots();
    compte.textContent = mots.length === 0
      ? 'Aucun mot pour l’instant. Touchez un mot souligné, puis « Ajouter au dictionnaire » : il ne sera plus jamais souligné.'
      : `${mots.length.toLocaleString('fr-FR')} mot${mots.length > 1 ? 's' : ''}, jamais soulignés :`;
    liste.replaceChildren(...mots.map((mot) => {
      const ligne = document.createElement('li');
      const texte = document.createElement('span');
      texte.className = 'correcteur-mot';
      texte.lang = 'fr';
      texte.textContent = mot;
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = classes.boutonDiscret ?? '';
      retirer.dataset.mot = mot;
      retirer.textContent = 'Retirer';
      retirer.setAttribute('aria-label', `Retirer « ${mot} »`);
      ligne.append(texte, retirer);
      return ligne;
    }));
  }

  const intro = document.createElement('p');
  intro.className = 'correcteur-intro';
  intro.textContent = 'Les mots de cette liste ne sont jamais soulignés. Elle est gardée sur cet appareil seulement.';
  conteneur.replaceChildren(intro, formulaire, message, compte, liste);
  afficher();
  return correcteur.ecouter((raison) => {
    if (raison === 'mots') afficher();
  });
}
