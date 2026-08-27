/* Vergleicht die Ableitung im Browser mit der aus Python.
   Aufruf: node tests/hilfen/paritaet.mjs <seite.html> <projekt.knxproj> [passwort]

   Die Seite wird ueber die Rueckschleife ausgeliefert statt ueber file://:
   crypto.subtle gibt es nur in sicheren Kontexten, und ohne das laesst sich
   ein passwortgeschuetztes Projekt nicht entschluesseln. Nach aussen geht
   dabei nichts. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const [seite, projekt, passwort] = process.argv.slice(2);
const inhalt = readFileSync(seite);

const server = createServer((_, antwort) => {
  antwort.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  antwort.end(inhalt);
});
await new Promise(fertig => server.listen(0, '127.0.0.1', fertig));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const tab = await browser.newPage();
const fehler = [];
tab.on('pageerror', e => fehler.push(String(e.message)));
if (passwort) {
  tab.on('dialog', async d => d.accept(passwort));
}
await tab.goto(`http://127.0.0.1:${port}/`);
await tab.waitForSelector('#dateifeld', { state: 'attached' });
await tab.setInputFiles('#dateifeld', projekt);
await tab.waitForFunction(
  () => document.getElementById('meldungen').textContent.includes('umgewandelt') ||
        document.getElementById('meldungen').textContent.includes('fehlgeschlagen') ||
        document.getElementById('meldungen').textContent.includes('abgebrochen'),
  { timeout: 60000 });

const ergebnis = await tab.evaluate(() => {
  const meldung = document.getElementById('meldungen').textContent;
  if (!meldung.includes('umgewandelt')) return { fehler: meldung };
  const projekt = SAMMLUNG.projekte[SAMMLUNG.projekte.length - 1];
  const punkte = projekt.pfade.b.punkte.map(p => ({
    ga: p.ga, ga_text: p.ga_text, name: p.name, dpt: p.dpt,
    raum: p.herkunft.raum ? p.herkunft.raum.wert : null,
    raum_quelle: p.herkunft.raum ? p.herkunft.raum.quelle : null,
    funktion: p.herkunft.funktion ? p.herkunft.funktion.wert : null,
    rolle: p.herkunft.rolle ? p.herkunft.rolle.wert : null,
    rolle_quelle: p.herkunft.rolle ? p.herkunft.rolle.quelle : null,
    dpt_quelle: p.herkunft.dpt ? p.herkunft.dpt.quelle : null,
    wertebereich: p.wertebereich,
    werte: p.werte,
  }));
  return { projekt: projekt.projekt, punkte };
});

console.log(JSON.stringify(ergebnis));
if (fehler.length) console.error('JS-FEHLER: ' + fehler.join(' | '));
await browser.close();
server.close();
process.exit(fehler.length ? 1 : 0);
