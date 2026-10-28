import {renderTrackBoard} from './mobile-route.mjs';
// The wiring-only step does not depend on timetable fetch success, train state
// or a navigation recommendation. Re-enable the existing engine only after
// accepting this infrastructure layer; do not mix guessed train tracks into it.
const root=document.getElementById('rail');
renderTrackBoard(root);
