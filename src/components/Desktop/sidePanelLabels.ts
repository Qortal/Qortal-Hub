import type { TFunction } from 'i18next';
import type { SidePanelItem } from './sidePanel';

/** A side panel button's name, as the panel and its editor show it. */
export const sidePanelItemLabel = (item: SidePanelItem, t: TFunction) => {
  switch (item.kind) {
    case 'home':
      return t('core:home', { postProcess: 'capitalizeFirstChar' });
    case 'apps':
      return t('core:app_other', { postProcess: 'capitalizeFirstChar' });
    case 'qchat':
      return 'Q-Chat';
    case 'dev':
      return t('core:dev_mode', { postProcess: 'capitalizeFirstChar' });
    case 'divider':
      return t('core:side_panel.divider', {
        postProcess: 'capitalizeFirstChar',
      });
    case 'info':
      return t('core:side_panel.node_information', {
        postProcess: 'capitalizeFirstChar',
      });
    case 'language':
      return t('core:side_panel.language', {
        postProcess: 'capitalizeFirstChar',
      });
    case 'theme':
      return t('core:side_panel.theme', {
        postProcess: 'capitalizeFirstChar',
      });
    default:
      return item.name;
  }
};
