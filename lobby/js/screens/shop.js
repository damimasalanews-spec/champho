import { store } from '../store.js';
import { SHOP_ITEMS, SHOP_CATS } from '../data.js';
import { icon, esc, toast, rarityClass, confirmDialog } from '../ui.js';

const CAT_OF = { characters: 'characters', frames: 'frames', effects: 'effects' };

export default {
  title: 'Style store',
  crumb: 'Shop',
  nav: 'shop',

  render() {
    let cat = 'all';

    const el = document.createElement('div');
    el.className = 'screen screen--shop';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Cosmetic shop</span>
          <h1>Style store</h1>
          <p>Characters, frames and effects. Everything here is cosmetic — nothing in this store changes a card.</p>
        </div>

      </div>

      <div class="row" style="margin-bottom:var(--s-5);flex-wrap:wrap;gap:var(--s-3)">
        <div class="segmented" role="tablist" aria-label="Category">
          ${SHOP_CATS.map((c) => `
            <button role="tab" data-cat="${c.id}" aria-selected="${c.id === 'all'}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>

      <div class="shop-grid" data-grid></div>

      <p class="muted" style="font-size:var(--fs-xs);margin-top:var(--s-6)">
        ${SHOP_ITEMS.length} items · rotation refreshes every Monday
      </p>
    `;

    const grid = el.querySelector('[data-grid]');

    function paint() {
      const items = SHOP_ITEMS.filter((item) => cat === 'all' || item.cat === cat);
      grid.innerHTML = items.map((item) => {
        const owned = store.state.owned.includes(item.id);
        const equipped = store.state.equipped[CAT_OF[item.cat]] === item.id;
        return `
          <article class="item reveal ${rarityClass(item.rarity)}" data-item="${esc(item.id)}">
            ${item.rarity === 'legend' ? '<span class="item__flag">Legend</span>' : ''}
            <div class="item__art">${icon(item.icon)}</div>
            <div>
              <span class="rarity-tag">${esc(item.rarity)}</span>
              <div class="item__name">${esc(item.name)}</div>
            </div>
            <div class="item__foot">
              ${owned
                ? `<button class="btn btn--quiet btn--sm" type="button" data-equip="${esc(item.id)}">
                     ${equipped ? `${icon('check')} Equipped` : 'Equip'}
                   </button>`
                : `<span class="price ${item.currency === 'gems' ? 'price--gems' : ''}">
                     ${icon(item.currency === 'gems' ? 'gem' : 'coin')} ${item.price}
                   </span>
                   <button class="btn btn--primary btn--sm" type="button" data-buy="${esc(item.id)}">Buy</button>`}
            </div>
          </article>`;
      }).join('');

      grid.querySelectorAll('[data-buy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const item = SHOP_ITEMS.find((i) => i.id === btn.dataset.buy);
          if (!item) return;
          const ok = await confirmDialog({
            title: `Buy ${item.name}?`,
            body: `${item.price} ${item.currency === 'gems' ? 'diamonds' : 'coins'} will be taken from your balance.`,
            confirmLabel: 'Buy it'
          });
          if (!ok) return;
          const problem = store.buy(item);
          if (problem) {
            toast(problem, 'bad');
            return;
          }
          toast(`${item.name} added to your collection.`, 'good');
          paint();
        });
      });

      grid.querySelectorAll('[data-equip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = SHOP_ITEMS.find((i) => i.id === btn.dataset.equip);
          if (!item) return;
          store.equip(item, CAT_OF[item.cat]);
          const on = store.state.equipped[CAT_OF[item.cat]] === item.id;
          toast(on ? `${item.name} equipped.` : `${item.name} removed.`, 'good');
          paint();
        });
      });

      // new cards animate in with a stagger
      grid.querySelectorAll('.reveal').forEach((card, i) => {
        card.style.setProperty('--reveal-delay', `${Math.min(i, 10) * 40}ms`);
        requestAnimationFrame(() => card.classList.add('is-in'));
      });
    }

    el.querySelectorAll('[data-cat]').forEach((tab) => {
      tab.addEventListener('click', () => {
        cat = tab.dataset.cat;
        el.querySelectorAll('[data-cat]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        paint();
      });
    });

    paint();
    return el;
  }
};
