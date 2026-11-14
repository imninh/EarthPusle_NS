// Dev-only entry for demo.html (task W1). Not part of the production build.
import { createRoot } from 'react-dom/client'
import GlobeDemo from './GlobeDemo'

createRoot(document.getElementById('root') as HTMLElement).render(<GlobeDemo />)
