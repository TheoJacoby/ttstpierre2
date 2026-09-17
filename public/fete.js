/* Petite animation de fin de match (victoire / nul / défaite), partagée par la TV et la page capitaine. */
window.Fete = (() => {
  const COULEURS = ['#ff6b35', '#ffd700', '#00f2a9', '#4a9eff', '#ff4b4b', '#ffffff', '#c86bff'];
  let timer = null;

  function show({ type, titre, sousTitre = '', duree = 6000 }) {
    hide();
    const overlay = document.createElement('div');
    overlay.className = `fete-overlay fete-${type}`;
    overlay.innerHTML = `
      <div class="fete-fx"></div>
      <div class="fete-content">
        <div class="fete-emoji">${type === 'victoire' ? '🏆' : type === 'nul' ? '🤝' : '😢'}</div>
        <div class="fete-titre">${escape(titre)}</div>
        <div class="fete-sous">${escape(sousTitre)}</div>
        <div class="fete-mot">${type === 'victoire' ? 'Victoire !' : type === 'nul' ? 'Match nul' : 'Défaite…'}</div>
      </div>`;
    const fx = overlay.querySelector('.fete-fx');
    if (type === 'victoire') confettis(fx, 140);
    else if (type === 'defaite') larmes(fx, 26);
    else poignee(fx, 18);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('on'));
    timer = setTimeout(hide, duree);
    overlay.addEventListener('click', hide);
  }

  function hide() {
    clearTimeout(timer);
    document.querySelectorAll('.fete-overlay').forEach((el) => { el.classList.remove('on'); setTimeout(() => el.remove(), 500); });
  }

  function confettis(root, n) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.cssText = `left:${Math.random() * 100}%;background:${COULEURS[i % COULEURS.length]};animation-delay:${Math.random() * 2.5}s;animation-duration:${3 + Math.random() * 2.5}s;transform:rotate(${Math.random() * 360}deg);width:${6 + Math.random() * 8}px;height:${10 + Math.random() * 10}px;border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
      root.appendChild(c);
    }
  }
  function larmes(root, n) {
    for (let i = 0; i < n; i++) {
      const l = document.createElement('i');
      l.className = 'larme';
      l.style.cssText = `left:${35 + Math.random() * 30}%;animation-delay:${Math.random() * 3}s;animation-duration:${2 + Math.random() * 1.5}s`;
      l.textContent = '💧';
      root.appendChild(l);
    }
  }
  function poignee(root, n) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'bulle';
      p.style.cssText = `left:${Math.random() * 100}%;animation-delay:${Math.random() * 3}s;animation-duration:${3 + Math.random() * 2}s;font-size:${1.2 + Math.random() * 1.5}rem`;
      p.textContent = ['🤝', '👏', '🏓', '✨'][i % 4];
      root.appendChild(p);
    }
  }
  function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** Type d'animation d'après le score de Saint-Pierre */
  function typeFor(scoreSp, scoreAdv) { return scoreSp > scoreAdv ? 'victoire' : scoreSp < scoreAdv ? 'defaite' : 'nul'; }

  return { show, hide, typeFor };
})();
