// 5313 R8 verified all 247 non-start marks against its v10 rule.
const types=['alert','chat','burst'];
export function boardRoadGlyph(col,row){if(col===14&&row===10)return 'start';return types[((col+2*row)%3+3)%3];}
