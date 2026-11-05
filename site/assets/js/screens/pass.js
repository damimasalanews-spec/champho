import { store } from '../store.js';
import { PASS_TIERS, SEASON } from '../data.js';
import { icon, esc, compact, toast, progressBar, rarityClass } from '../ui.js';

export default {
  title: 'Season pass',
  crumb: 'Season',
  nav: 'pass',

  render() {
    const el = document.createElement('div');
    el.className = 'screen screen--pass';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
          <h1>Earn XP. Unlock the track.</h1>
          <p>Every match, mission and daily reward pushes the season forward. Tiers are granted once each, by the server.</p>
        </div>
        <div class="pill pill--gold">${SEASON.daysLeft} days left</div>
      </div>

      <section class="pass-head reveal" data-pass-head></section>

      <section class="section">
        <div class="section__head">
          <h2>Reward track</h2>
          <span class="muted" style="font-size:var(--fs-xs)">Scroll for later tiers</span>
        </div>
        <div class="track" data-track></div>
      </section>

      <section class="section">
        <div class="panel">
          <div class="panel__head"><h2>How the track works</h2></div>
          <div class="panel__body" style="display:grid;gap:var(--s-3);font-size:var(--fs-sm);color:var(--ivory-dim)">
            <p>Season XP is earned per round: a win pays more than a loss, and missions pay a flat bonus.</p>
            <p>Cosmetic tiers arrive in your collection and can be equipped from the <b>Style store</b> or your <b>Profile</b>.</p>
            <p>Coin and diamond tiers are added straight to the wallet. Nothing on this track is purchasable.</p>
          </div>
        </div>
      </section>
    `;

    paint(el);
    return el;
  }
};

function paint(el) {
  const { player, claimedTiers } = store.state;
  const xp = player.seasonXp;
  const next = PASS_TIERS.find((t) => t.xp > xp);
  const currentTier = [...PASS_TIERS].reverse().find((t) => xp >= t.xp) ?? PASS_TIERS[0];

  el.querySelector('[data-pass-head]').innerHTML = `
    <div>
      <span class="eyebrow">Your season progress</span>
      <h2 style="margin-top:var(--s-2)">Tier ${currentTier.tier} of ${PASS_TIERS.length}</h2>
      <p class="muted" style="font-size:var(--fs-sm);margin-top:6px">
        ${next ? `${compact(next.xp - xp)} XP to tier ${next.tier} — ${esc(next.name)}` : 'Every tier is unlocked. The season is yours.'}
      </p>
      <div style="margin-top:var(--s-4);max-width:520px">
        ${progressBar(xp, 7200, { jade: true, label: 'Season XP' })}
        <div class="meter__label" style="margin-top:8px"><span>${compact(xp)} XP</span><span>7,200 XP</span></div>
      </div>
    </div>
    <div style="display:grid;gap:var(--s-2);min-width:180px">
      <span class="pill">${claimedTiers.length} / ${PASS_TIERS.length} claimed</span>
      <span class="pill">${player.gems} diamonds · ${compact(player.coins)} coins</span>
    </div>
  `;

  const track = el.querySelector('[data-track]');
  track.innerHTML = PASS_TIERS.map((tier) => {
    const unlocked = xp >= tier.xp;
    const claimed = claimedTiers.includes(tier.tier);
    const isCurrent = !claimed && unlocked;
    return `
      <article class="tier ${claimed ? 'tier--unlocked' : ''} ${isCurrent ? 'tier--current' : ''} ${unlocked ? '' : 'tier--locked'} ${rarityClass(tier.rarity)}">
        <span class="tier__no">TIER ${String(tier.tier).padStart(2, '0')}</span>
        <span class="tier__art">${icon(claimed ? 'check' : unlocked ? tier.icon : 'lock')}</span>
        <span class="tier__name">${esc(tier.name)}</span>
        <span class="rarity-tag">${esc(tier.rarity)}</span>
        ${claimed
          ? '<span class="pill pill--jade" style="justify-content:center">Claimed</span>'
          : unlocked
            ? `<button class="btn btn--primary btn--sm" type="button" data-claim="${tier.tier}">Claim</button>`
            : `<span class="muted" style="font-size:var(--fs-2xs)">${compact(tier.xp)} XP</span>`}
      </article>`;
  }).join('');

  track.querySelectorAll('[data-claim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tier = PASS_TIERS.find((t) => String(t.tier) === btn.dataset.claim);
      const granted = store.claimTier(tier);
      if (!granted) return;
      if (granted.kind === 'coins') toast(`Tier ${granted.tier} — +${compact(granted.amount)} coins`, 'good');
      else if (granted.kind === 'gems') toast(`Tier ${granted.tier} — +${granted.amount} diamonds`, 'good');
      else toast(`Tier ${granted.tier} — ${granted.name} added to your collection`, 'good');
      paint(el);
    });
  });
}
