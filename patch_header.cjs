const fs = require('fs');
let code = fs.readFileSync('src/components/Header.tsx', 'utf8');

code = code.replace(
  "onPagConverterOpen: () => void;",
  "onPagConverterOpen: () => void;\n  onName3DEditorOpen: () => void;"
);

const newToolDef = `{ id: 'name-3d', label: '3D Name Editor', icon: <Sparkles className="w-4 h-4" />, actionKey: 'onName3DEditorOpen', descAr: 'محرر احترافي لإنشاء وتصميم أسماء 3D مع تحكم كامل بالخطوط والزخارف والإضاءة', descEn: 'Professional 3D Name Editor with full control over fonts, ornaments, and lighting.', highlight: true },`;

// Let's add it to the category: "أنيميشن و SVGA" or create a new one. 
// I'll create a new category just for Design. Wait, let's just put it in "معالجة الصور والذكاء الاصطناعي" for now.
code = code.replace(
  "{ id: 'image-enhancer', label: 'AI Image Enhancer',",
  newToolDef + "\n      { id: 'image-enhancer', label: 'AI Image Enhancer',"
);

fs.writeFileSync('src/components/Header.tsx', code);
