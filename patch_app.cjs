const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "import PrivateChat from './components/PrivateChat';",
  "import PrivateChat from './components/PrivateChat';\nimport Name3DEditor from './components/Name3DEditor/Name3DEditor';"
);

code = code.replace(
  "case 'batchImageOpen': setShowBatchImage(true); break;",
  "case 'batchImageOpen': setShowBatchImage(true); break;\n                        case 'name3DEditor': handleFeatureAccess(AppState.NAME_3D_EDITOR, '3D Name Editor'); break;"
);

code = code.replace(
  "onPagConverterOpen={() => setShowPagConverter(true)}",
  "onPagConverterOpen={() => setShowPagConverter(true)}\n        onName3DEditorOpen={() => handleFeatureAccess(AppState.NAME_3D_EDITOR, '3D Name Editor')}"
);

code = code.replace(
  "state === AppState.MULTI_SVGA_VIEWER ? 'multi-svga' :",
  "state === AppState.MULTI_SVGA_VIEWER ? 'multi-svga' :\n          state === AppState.NAME_3D_EDITOR ? 'name-3d' :"
);

code = code.replace(
  "{state === AppState.MULTI_SVGA_VIEWER && (",
  "{state === AppState.NAME_3D_EDITOR && (\n              <Name3DEditor \n                onCancel={handleReset} \n                currentUser={currentUser}\n                onSubscriptionRequired={() => setShowSubscriptionModal(true)}\n              />\n            )}\n            {state === AppState.MULTI_SVGA_VIEWER && ("
);

fs.writeFileSync('src/App.tsx', code);
