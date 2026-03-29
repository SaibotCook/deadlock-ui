import { Component, Prop, State, Watch, Element, h } from '@stencil/core';
import { Item, ItemSlotType } from '../../types';
import { fetchItems, fetchGenericData } from '../../api/client';
import { configState, onConfigChange } from '../../store/config-store';
import { shopBackground, shopTabShape, shopTabIcon, shopTabEdgeOverlay, soulIcon } from '../../utils/assets';
import { ComponentItemInfo } from '../dl-item-tooltip/dl-item-tooltip';

const CATEGORIES: { label: string; slot: ItemSlotType; color: string }[] = [
  { label: 'Weapon', slot: 'weapon', color: '#e4b20c' },
  { label: 'Vitality', slot: 'vitality', color: '#a5ce3c' },
  { label: 'Spirit', slot: 'spirit', color: '#b866de' },
];

const VALID_TABS = new Set<string>(CATEGORIES.map(c => c.slot));

const TIERS = [1, 2, 3, 4] as const;

@Component({
  tag: 'dl-shop-panel',
  styleUrl: 'dl-shop-panel.css',
  shadow: true,
})
export class DlShopPanel {
  @Element() el!: HTMLElement;

  /** The tab to display initially. One of `"weapon"`, `"vitality"`, or `"spirit"`. */
  @Prop({ reflect: true, attribute: 'active-tab' }) activeTab: ItemSlotType = 'weapon';

  /** Hover effect applied to each item card. One of `"none"` or `"scale"`. */
  @Prop({ reflect: true, attribute: 'hover-effect' }) hoverEffect: 'none' | 'scale' = 'scale';

  /** When `true`, disables the highlight effect that dims unrelated items on hover. */
  @Prop({ reflect: true, attribute: 'disable-highlight' }) disableHighlight: boolean = false;

  @State() private _items: Item[] = [];
  @State() private _loading = false;
  @State() private _activeTab: ItemSlotType = 'weapon';
  @State() private _tierPrices: number[] = [];
  @State() private _highlightedItems: Set<string> | null = null;
  private _highlightSource: string | null = null;

  private _unsubLanguage?: () => void;
  /** Maps class_name → set of all related class_names in the upgrade chain */
  private _upgradeChains = new Map<string, Set<string>>();
  /** Maps class_name → resolved component item info for tooltips */
  private _componentItemsMap = new Map<string, ComponentItemInfo[]>();

  @Watch('activeTab')
  onActiveTabChange(value: string) {
    if (VALID_TABS.has(value)) {
      this._activeTab = value as ItemSlotType;
    }
  }

  connectedCallback() {
    if (VALID_TABS.has(this.activeTab)) {
      this._activeTab = this.activeTab;
    }
    this.loadItems();
    this.loadGenericData();
    this._unsubLanguage = onConfigChange('language', () => {
      this.loadItems();
    });
  }

  disconnectedCallback() {
    this._unsubLanguage?.();
  }

  private async loadItems() {
    this._loading = true;
    try {
      const language = configState.language;
      const items = await fetchItems(language);
      this._items = items
        .filter(i => i.type === 'upgrade' && i.shopable && !i.disabled)
        .sort((a, b) => a.name.localeCompare(b.name));
      this.buildUpgradeChains();
    } catch {
      this._items = [];
    } finally {
      this._loading = false;
    }
  }

  private buildUpgradeChains() {
    // Build parent map: component_class_name → [items that use it as component]
    const parentOf = new Map<string, string[]>();
    for (const item of this._items) {
      if (item.component_items) {
        for (const comp of item.component_items) {
          const list = parentOf.get(comp) ?? [];
          list.push(item.class_name);
          parentOf.set(comp, list);
        }
      }
    }

    // For each item, walk the full chain (up and down) and cache the result
    const chains = new Map<string, Set<string>>();

    const collectChain = (className: string): Set<string> => {
      if (chains.has(className)) return chains.get(className)!;

      const chain = new Set<string>();
      const queue = [className];
      while (queue.length > 0) {
        const current = queue.pop()!;
        if (chain.has(current)) continue;
        chain.add(current);

        // Walk down: find components of current
        const item = this._items.find(i => i.class_name === current);
        if (item?.component_items) {
          for (const comp of item.component_items) {
            if (!chain.has(comp)) queue.push(comp);
          }
        }

        // Walk up: find items that use current as component
        const parents = parentOf.get(current);
        if (parents) {
          for (const p of parents) {
            if (!chain.has(p)) queue.push(p);
          }
        }
      }
      return chain;
    };

    for (const item of this._items) {
      if (item.component_items?.length || parentOf.has(item.class_name)) {
        const chain = collectChain(item.class_name);
        // Share the same Set for all items in the chain
        for (const cn of chain) {
          chains.set(cn, chain);
        }
      }
    }

    this._upgradeChains = chains;

    // Build component items map for tooltips
    const byClassName = new Map<string, Item>(this._items.map(i => [i.class_name, i]));
    const componentMap = new Map<string, ComponentItemInfo[]>();
    for (const item of this._items) {
      if (item.component_items?.length) {
        const resolved: ComponentItemInfo[] = [];
        for (const cn of item.component_items) {
          const comp = byClassName.get(cn);
          if (!comp) continue;
          resolved.push({
            name: comp.name,
            image: comp.shop_image_webp || comp.shop_image || comp.image_webp || comp.image || undefined,
          });
        }
        if (resolved.length > 0) {
          componentMap.set(item.class_name, resolved);
        }
      }
    }
    this._componentItemsMap = componentMap;
  }

  private handleTooltipOpen = (e: CustomEvent<string>) => {
    if (this.disableHighlight) return;
    const className = e.detail;
    this._highlightSource = className;
    const chain = this._upgradeChains.get(className);
    this._highlightedItems = chain ?? new Set([className]);
  };

  private handleTooltipClose = (e: CustomEvent<string>) => {
    if (e.detail !== this._highlightSource) return;
    this._highlightedItems = null;
    this._highlightSource = null;
  };

  private async loadGenericData() {
    try {
      const data = await fetchGenericData();
      this._tierPrices = data.item_price_per_tier;
    } catch {
      this._tierPrices = [];
    }
  }

  private getItemsBySlotAndTier(slot: ItemSlotType, tier: number): Item[] {
    return this._items.filter(
      i => i.item_slot_type === slot && i.item_tier === tier,
    );
  }

  private handleTabClick(slot: ItemSlotType) {
    this._activeTab = slot;
  }

  render() {
    if (this._loading) {
      return <div class="shop"><div class="loading">Loading items...</div></div>;
    }

    return (
      <div class="shop">
        <div class="nav-container">
          {CATEGORIES.map(cat => {
            const isActive = this._activeTab === cat.slot;
            return (
              <div
                class={{ 'category-tab': true, [`is-${cat.slot}`]: true, 'active': isActive }}
                onClick={() => this.handleTabClick(cat.slot)}
              >
                <div class={{ 'category-icon-container': true, 'active': isActive }}>
                  <div
                    class="tab-shape"
                    style={{
                      backgroundColor: cat.color,
                      maskImage: `url("${shopTabShape()}")`,
                      WebkitMaskImage: `url("${shopTabShape()}")`,
                    }}
                  ></div>
                  <img class="tab-icon" src={shopTabIcon(cat.slot)} />
                  <div
                    class="tab-edge-overlay"
                    style={{ backgroundImage: `url("${shopTabEdgeOverlay()}")` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
        <div
          class={{ 'tiers': true, [this._activeTab]: true }}
          style={{ backgroundImage: `url("${shopBackground(this._activeTab)}")` }}
        >
          {TIERS.map(tier => {
            const items = this.getItemsBySlotAndTier(this._activeTab, tier);
            const price = this._tierPrices[tier];
            return (
              <div class={{ 'tier-section': true, [`tier-${tier}`]: true }}>
                {price != null && (
                  <div class={{ 'tier-price': true, [`tier-${tier}`]: true }}>
                    <img class="soul-icon" src={soulIcon()} alt="" />
                    <span>{price.toLocaleString()}</span>
                  </div>
                )}
                {items.length > 0 && (
                  <div class={{ 'mods-grid': true, [`tier-${tier}`]: true }}>
                    {items.map(item => {
                      const isHighlighting = this._highlightedItems !== null;
                      const isRelated = isHighlighting && this._highlightedItems!.has(item.class_name);
                      return (
                        <div
                          class={{
                            'item-wrapper': true,
                            'dimmed': isHighlighting && !isRelated,
                            'highlighted': isRelated,
                          }}
                        >
                          <dl-item-card
                            itemData={item}
                            hoverEffect={this.hoverEffect}
                            componentItemsData={this._componentItemsMap.get(item.class_name)}
                            onTooltipOpen={this.handleTooltipOpen}
                            onTooltipClose={this.handleTooltipClose}
                          ></dl-item-card>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
