/* Omni-Romancier — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Tests automatiques d'Omni-Romancier.
   Ils ouvrent l'application dans un vrai navigateur (Chromium, piloté
   par Playwright), créent un roman, un chapitre, écrivent une scène,
   testent le correcteur orthographique, rechercher/remplacer, les fiches,
   les exports JSON/ePub, la mise à jour manuelle du SW et l'accès hors
   ligne (dont correcteur/LICENCE-dictionnaire.txt et fonts/OFL.txt).

   Lancer (Playwright doit être installé) :  node tests/tester.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const {
  lancer,
  section,
  verifier,
  nouvellePage,
  controlesCommuns,
  RACINE,
  adresse,
  remplacer,
  reinitialiserSubstitutions
} = require('./outils.js');

const texte = (p, sel) => p.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const PHRASES = 'La pluie tombait sur Valombre. Ilyan serra son manteau contre lui et poussa la porte de l’auberge.';

lancer('Omni-Romancier', async () => {
  await controlesCommuns({ serviceWorker: 'sw.js' });

  const { ctx, p } = await nouvellePage({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  await p.waitForTimeout(800);

  await section('Créer un roman', async () => {
    await p.click('#bouton-nouveau-roman');
    await p.fill('dialog[open] input[name="titre"]', 'Les Brumes de Valombre');
    await p.click('dialog[open] button[type="submit"]');
    await p.waitForTimeout(500);
    verifier((await texte(p, '#liste-romans')).includes('Les Brumes de Valombre'), 'le roman apparaît dans la bibliothèque');
  });

  await section('Écrire une scène', async () => {
    await p.click('#liste-romans a:has-text("Ouvrir")');
    await p.waitForSelector('#vue-roman:not([hidden])');
    await p.click('#bouton-premier-chapitre');
    await p.waitForSelector('dialog[open]');
    await p.click('dialog[open] button[type="submit"]');      // « Chapitre 1 » proposé
    await p.waitForTimeout(500);
    // Le compteur ne compte que le texte « Rédigé » (les notes sont un brouillon).
    await p.click('[data-mode="redige"]');
    await p.click('#texte-redige');
    await p.keyboard.type(PHRASES);
    await p.waitForTimeout(1500);
    const mots = await texte(p, '#mots-scene');
    verifier(mots.startsWith('17'), 'compteur de la scène : 17 mots (« l’auberge » = 1 mot)', mots);
    verifier((await texte(p, '#mots-roman')).includes('17'), 'compteur du roman : 17 mots', await texte(p, '#mots-roman'));
    verifier(/enregistr/i.test(await texte(p, '#etat-enregistrement')), 'le texte est enregistré tout seul', await texte(p, '#etat-enregistrement'));
  });

  await section('Rien ne se perd à la fermeture', async () => {
    await p.reload();
    await p.waitForTimeout(1500);
    const contenu = await p.$eval('#texte-redige', (e) => e.value).catch(() => '');
    verifier(contenu.includes('poussa la porte de l’auberge'), 'la scène est retrouvée telle quelle', contenu.slice(0, 50));
  });

  await section('Sauvegarde du roman dans un fichier', async () => {
    await p.goto(p.url().split('#')[0]);
    await p.waitForTimeout(800);
    const bouton = await p.$('[data-action="exporter"]:visible');
    if (!bouton) { verifier(false, 'bouton d’export trouvé'); return; }
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), bouton.click()]);
    const contenu = fs.readFileSync(await telechargement.path(), 'utf8');
    verifier(contenu.includes('Valombre') && contenu.includes('auberge'), 'le fichier contient le roman et sa scène');
  });

  await section('Deux personnages principaux épinglés', async () => {
    await p.click('#liste-romans a:has-text("Ouvrir")');
    await p.waitForSelector('#vue-roman:not([hidden])');
    await p.waitForTimeout(500);
    for (const [nom, apparence] of [['Ilyan', 'Grand, une cicatrice'], ['Maëlle', 'Cheveux courts']]) {
      await p.click('[data-onglet="principal"]');
      await p.click('#contenu-panneau [data-action="nouvelle"]');
      await p.fill('#contenu-panneau input[name="titre"]', nom);
      await p.fill('#contenu-panneau textarea[name="apparence"]', apparence);
      await p.click('#contenu-panneau button[type="submit"]');
      await p.waitForTimeout(500);
    }
    const epinglees = await p.$$eval('#epinglee .epinglee-fiche .fiche-titre', (l) => l.map((e) => e.textContent));
    verifier(epinglees.join() === 'Ilyan,Maëlle', 'les deux personnages principaux sont épinglés', epinglees.join());
  });

  await section('Correcteur orthographique français', async () => {
    await p.click('#bouton-orthographe');
    await p.waitForSelector('dialog[open] #correction-active');
    const dejaActif = await p.isChecked('dialog[open] #correction-active');
    if (!dejaActif) await p.check('dialog[open] #correction-active');
    await p.click('dialog[open] button:has-text("Fermer")');
    await p.waitForSelector('dialog[open]', { state: 'detached' });

    await p.click('[data-mode="redige"]');
    await p.click('#texte-redige');
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('maison lumière erreeeuuur.');
    await p.waitForFunction(
      () => [...document.querySelectorAll('#calque-redige mark.faute')].some((m) => m.textContent === 'erreeeuuur'),
      null,
      { timeout: 15000 }
    );
    const fautes = await p.$$eval('#calque-redige mark.faute', (l) => l.map((m) => m.textContent));
    verifier(fautes.includes('erreeeuuur'), 'le mot fautif « erreeeuuur » est souligné', fautes);
    verifier(
      !fautes.includes('maison') && !fautes.includes('lumière'),
      'les mots français valides (« maison », « lumière ») ne sont pas soulignés',
      fautes
    );
  });

  await section('Rechercher et remplacer avec espace final (, → , )', async () => {
    await p.click('[data-mode="redige"]');
    await p.click('#texte-redige');
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Alpha,bêta.');
    await p.waitForTimeout(400);

    await p.click('#bouton-remplacer');
    await p.waitForSelector('#barre-recherche:not([hidden])');
    await p.fill('#br-chercher', ',');
    await p.fill('#br-par', ', ');
    await p.waitForSelector('#br-tout:not([disabled])', { timeout: 5000 });
    await p.click('#br-tout');
    await p.waitForSelector('dialog[open]');
    await p.click('dialog[open] button[type="submit"]');
    await p.waitForTimeout(500);
    await p.click('#br-fermer');

    const contenu = await p.$eval('#texte-redige', (e) => e.value);
    verifier(contenu.includes('Alpha, bêta.'), 'le remplacement « , » → « ,  » conserve l’espace finale', contenu.slice(-30));
  });

  await section('Export avec les notes et les fiches', async () => {
    await p.click('[data-mode="notes"]');
    await p.click('#texte-notes');
    await p.keyboard.type('Indice caché sous le comptoir');
    await p.waitForTimeout(800);
    await p.click('#bouton-pdf');
    await p.waitForSelector('dialog[open]');
    await p.check('dialog[open] input[name="type"][value="epub"]');
    await p.check('dialog[open] input[name="notes"]');
    await p.check('dialog[open] input[name="fiches"]');
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('dialog[open] button[type="submit"]')]);
    const contenu = fs.readFileSync(await telechargement.path()).toString('latin1'); // (ePub non compressé : le texte se lit tel quel)
    verifier(contenu.includes('Notes des sc') && contenu.includes('comptoir'), 'les notes des scènes sont dans l’ePub');
    verifier(contenu.includes('Fiches') && contenu.includes('cicatrice') && contenu.includes('Cheveux courts'), 'les fiches sont dans l’ePub');
  });

  await ctx.close();

  await section('Mise à jour manuelle du SW et accès hors ligne aux licences', async () => {
    const { ctx: ctxPwa, p: pPwa } = await nouvellePage();
    await pPwa.evaluate(() => navigator.serviceWorker.ready);
    await pPwa.reload();
    await pPwa.waitForTimeout(800);

    const bandeauCache = await pPwa.$eval('#bandeau-mise-a-jour', (el) => el.hidden);
    verifier(bandeauCache === true, '#bandeau-mise-a-jour est caché au démarrage');

    const versionInitiale = await pPwa.evaluate(() =>
      window.CONFIG_APP?.version || document.getElementById('numero-version')?.textContent?.trim()
    );
    const configSource = fs.readFileSync(path.join(RACINE, 'js', 'config.js'), 'utf8');
    remplacer('js/config.js', configSource.replace(/version:\s*(['"])[^'"]+\1/, 'version: $199.0.0$1'));
    try {
      await pPwa.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      });
      await pPwa.waitForSelector('#bandeau-mise-a-jour:not([hidden])', { timeout: 15000 });
      const libelleMaj = (await pPwa.textContent('#bouton-mise-a-jour')).trim();
      verifier(libelleMaj === 'Mettre à jour', 'le bouton « Mettre à jour » apparaît', libelleMaj);

      const versionEnCours = await pPwa.evaluate(() =>
        window.CONFIG_APP?.version || document.getElementById('numero-version')?.textContent?.trim()
      );
      verifier(
        versionEnCours === versionInitiale && versionEnCours !== '99.0.0',
        'l’application en cours ne change pas avant clic sur « Mettre à jour »',
        { versionInitiale, versionEnCours }
      );
    } finally {
      reinitialiserSubstitutions();
    }

    await ctxPwa.setOffline(true);
    const respDico = await pPwa.goto(adresse() + 'correcteur/LICENCE-dictionnaire.txt');
    const texteDico = respDico ? await respDico.text() : '';
    verifier(
      Boolean(respDico && respDico.status() === 200 && texteDico.includes('Mozilla Public License')),
      'correcteur/LICENCE-dictionnaire.txt est accessible hors ligne via le Service Worker (200 OK)',
      { status: respDico?.status(), longueur: texteDico.length }
    );

    const respOfl = await pPwa.goto(adresse() + 'fonts/OFL.txt');
    const texteOfl = respOfl ? await respOfl.text() : '';
    verifier(
      Boolean(respOfl && respOfl.status() === 200 && texteOfl.includes('Oxanium') && texteOfl.includes('Literata') && texteOfl.includes('JetBrains Mono')),
      'fonts/OFL.txt est accessible hors ligne via le Service Worker (200 OK)',
      { status: respOfl?.status(), longueur: texteOfl.length }
    );

    await ctxPwa.close();
  });
});
