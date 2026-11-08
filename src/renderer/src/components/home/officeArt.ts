import type { OfficeType } from '@shared/offices'
import startupPreview from '../../assets/offices/startup.png'
import studioPreview from '../../assets/offices/studio.png'
import labPreview from '../../assets/offices/lab.png'

/** Real renders of each office (captured from the app itself, interface hidden). */
export const OFFICE_PREVIEW: Record<OfficeType, string> = { startup: startupPreview, studio: studioPreview, lab: labPreview }
