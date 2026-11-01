/* Omni-Romancier — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Tests automatiques d'Omni-Romancier.
   Ils ouvrent l'application dans un vrai navigateur (Chromium, piloté
   par Playwright), créent un roman, un chapitre, écrivent une scène et
   vérifient que rien ne se perd. Rien n'est envoyé sur internet.

   Lancer (Playwright doit être installé) :  node tests/tester.js
   ============================================================ */
'use strict';
const fs = require('fs');
const { lancer, section, verifier, nouvellePage, controlesCommuns } = require('./outils.js');

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

  await ctx.close();
});
