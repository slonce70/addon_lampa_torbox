const { test, expect } = require('@playwright/test');

test('TV focus smoke: Right opens filter, Up follows visual order', async ({ page }) => {
  await page.setContent(`
    <html>
      <body>
        <div id="bar">
          <button id="search">Search</button>
          <button id="sort">Sort</button>
          <button id="filter">Filter</button>
        </div>
        <button id="continue">Continue</button>
        <button id="item-1">Item 1</button>
        <div id="filter-panel" style="display:none">FILTER PANEL</div>
        <script>
          const focusOrder = ['search', 'sort', 'filter'];
          let zone = 'list';
          let listIndex = 0;
          let filterIndex = 2;
          const hasContinue = true;

          function zoneForId(id) {
            if (id === 'item-1') return 'list';
            if (id === 'continue') return 'continue';
            if (id === 'search' || id === 'sort' || id === 'filter') return 'filter';
            return zone;
          }

          function setFocus(id) {
            const el = document.getElementById(id);
            if (el) {
              zone = zoneForId(id);
              el.focus();
            }
          }

          document.addEventListener('focusin', (e) => {
            zone = zoneForId(e.target && e.target.id);
          });

          setFocus('item-1');

          window.addEventListener('keydown', (e) => {
            if (zone === 'list' && e.key === 'ArrowRight') {
              document.getElementById('filter-panel').style.display = 'block';
              zone = 'filter';
              setFocus('filter');
              e.preventDefault();
              return;
            }

            if (zone === 'list' && e.key === 'ArrowUp' && listIndex === 0) {
              if (hasContinue) {
                zone = 'continue';
                setFocus('continue');
              } else {
                zone = 'filter';
                filterIndex = 0;
                setFocus(focusOrder[filterIndex]);
              }
              e.preventDefault();
              return;
            }

            if (zone === 'continue' && e.key === 'ArrowUp') {
              zone = 'filter';
              filterIndex = 0;
              setFocus(focusOrder[filterIndex]);
              e.preventDefault();
              return;
            }
          });
        </script>
      </body>
    </html>
  `);

  await page.focus('#item-1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#filter-panel')).toBeVisible();

  await page.focus('#item-1');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#continue')).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#search')).toBeFocused();
});

test('Episode download focus smoke: row plays, download button does not', async ({ page }) => {
  await page.setContent(`
    <html>
      <body>
        <button id="episode-1" data-row="0">Episode 1</button>
        <button id="download-1" data-row="0">Download 1</button>
        <button id="episode-2" data-row="1">Episode 2</button>
        <button id="download-2" data-row="1">Download 2</button>
        <script>
          let zone = 'episode';
          let index = 0;
          window.playCount = 0;
          window.downloadCount = 0;

          function setFocus(nextZone, nextIndex) {
            zone = nextZone;
            index = nextIndex;
            document.getElementById((zone === 'download' ? 'download-' : 'episode-') + (index + 1)).focus();
          }

          document.getElementById('episode-1').focus();

          document.querySelectorAll('[id^="episode-"]').forEach((el) => {
            el.addEventListener('click', () => { window.playCount += 1; });
          });
          document.querySelectorAll('[id^="download-"]').forEach((el) => {
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              window.downloadCount += 1;
            });
          });

          window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' && zone === 'episode') {
              setFocus('download', index);
              e.preventDefault();
            } else if (e.key === 'ArrowLeft' && zone === 'download') {
              setFocus('episode', index);
              e.preventDefault();
            } else if (e.key === 'ArrowDown') {
              setFocus(zone, Math.min(index + 1, 1));
              e.preventDefault();
            } else if (e.key === 'ArrowUp') {
              setFocus(zone, Math.max(index - 1, 0));
              e.preventDefault();
            } else if (e.key === 'Enter') {
              document.activeElement.click();
              e.preventDefault();
            }
          });
        </script>
      </body>
    </html>
  `);

  await expect(page.locator('#episode-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.playCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.downloadCount)).toBe(0);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#download-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.downloadCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.playCount)).toBe(1);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#download-2')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#episode-2')).toBeFocused();
});
