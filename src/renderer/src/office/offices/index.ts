// Every office type's floor plan. A new office type adds its layout here (plus its art pack).

import type { OfficeType } from '@shared/offices'
import type { OfficeLayout } from '../layout'
import { startupLayout } from './startup'
import { labLayout } from './lab'
import { studioLayout } from './studio'

export const LAYOUTS: Record<OfficeType, OfficeLayout> = {
  startup: startupLayout,
  studio: studioLayout,
  lab: labLayout
}
