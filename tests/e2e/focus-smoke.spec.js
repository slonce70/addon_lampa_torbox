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
