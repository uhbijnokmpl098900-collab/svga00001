const fs = require('fs');

let content = fs.readFileSync('src/components/UniversalMotionTools.tsx', 'utf8');

const badCode = `                  )}
                </div>
              </div>
            ) : (`;

const fixedCode = `                  )}
                </div>
              </div>
              </>
            ) : (`;

content = content.replace(badCode, fixedCode);

const otherBadCode = `            {fileUrl ? (
              <div 
                className="relative w-full h-full flex flex-col items-center justify-center rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl transition-colors duration-300"`;

const otherFixedCode = `            {fileUrl ? (
              <>
              <div 
                className="relative w-full h-full flex flex-col items-center justify-center rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl transition-colors duration-300"`;

content = content.replace(otherBadCode, otherFixedCode);

fs.writeFileSync('src/components/UniversalMotionTools.tsx', content);
console.log("Syntax fixed");
