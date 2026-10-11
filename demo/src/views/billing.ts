import { h, pageHeader, textField, toast } from '../ui.ts';
import { settingsTabs } from './settings.ts';

export function billingView(): HTMLElement {
  const card = textField({ label: 'Card number', navoroId: 'billing.card-number', value: '4242 4242 4242 4242', autocomplete: 'cc-number', hint: 'Synthetic test card number — no real payment data.' });
  const tax = textField({ label: 'Tax ID', navoroId: 'billing.tax-id', value: 'SYN-00-0000000', autocomplete: 'off', hint: 'Synthetic placeholder.' });
  const region = h(
    'section',
    { class: 'card form', 'data-navoro-id': 'billing.payment-region', 'aria-labelledby': 'pay-h' },
    h('h2', { id: 'pay-h', class: 'card-title' }, 'Payment method'),
    h('p', { class: 'holder' }, 'Account holder: Jordan Avery (synthetic)'),
    card.root,
    tax.root,
    h('div', { class: 'form-actions form-actions-end' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => toast('Billing details saved.') }, 'Update payment method')),
  );
  const plan = h('section', { class: 'card', 'aria-labelledby': 'plan-h' }, h('div', { class: 'card-head' }, h('h2', { id: 'plan-h', class: 'card-title' }, 'Plan'), h('span', { class: 'pill pill-ok' }, 'Team')), h('p', {}, '10 seats · billed monthly'), h('p', { class: 'muted' }, 'Next invoice on Nov 1, 2026 — $240.00 (synthetic).'));
  return h('div', { class: 'view view-narrow' }, pageHeader('Settings', 'Manage your workspace, teammates, and billing.'), settingsTabs('billing'), plan, region);
}
