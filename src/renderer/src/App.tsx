import { useState } from 'react'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { AppShell } from './shell/AppShell'

function App(): React.JSX.Element {
  const [onboarded, setOnboarded] = useState(false)
  return onboarded ? (
    <AppShell companyName="My Company" />
  ) : (
    <OnboardingWizard onFinish={() => setOnboarded(true)} />
  )
}

export default App
