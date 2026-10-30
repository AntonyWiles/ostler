import { Suspense, type ComponentProps } from 'react'
import { lazyNamed } from '../lib/lazy-named'

const NewProjectWizard = lazyNamed(() => import('./NewProjectWizard'), 'NewProjectWizard')

/** The New project wizard, loaded the first time it opens (P9.1). */
export function NewProjectWizardLazy(props: ComponentProps<typeof NewProjectWizard>) {
  return (
    <Suspense fallback={null}>
      <NewProjectWizard {...props} />
    </Suspense>
  )
}
