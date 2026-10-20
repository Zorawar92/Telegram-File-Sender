// Registra il componente radice e definisce i task in background.
// IMPORTANTE: i task vanno definiti nel modulo di ingresso, così esistono anche
// quando Android avvia l'app in "headless" solo per eseguire il backup automatico.
import { registerRootComponent } from 'expo';

import './src/backgroundTasks';
import App from './App';

registerRootComponent(App);
