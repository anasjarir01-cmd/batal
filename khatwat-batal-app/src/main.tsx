import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/tajawal/800.css';
import './styles/app.css';
import './styles/battle.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { bootstrap } from './store/appStore';
import { registerPwa } from './pwa/register';

// الاتجاه واللغة على الجذر أيضًا من JS، لأن بعض بيئات العرض تضيف غلاف الصفحة بنفسها
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

void bootstrap();
void registerPwa();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
