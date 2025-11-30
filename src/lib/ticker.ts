export function parseTicker(ticker: string): { sport: string; teams: string; side: string } | null {
  // Format: KXNBAGAME-25NOV26MINOKC-OKC or KXNFLGAME-25NOV30LACAR-LA or KXNHLGAME-25NOV30TORMTL-TOR
  // or KXNCAABGAME-25NOV30DUKEUNC-DUKE or KXNCAAFGAME-25NOV30ALABAMA-AUB
  // or KXNCAAMBGAME-25NOV30DUKEUNC-DUKE (alternate college basketball prefix)
  const match = ticker.match(/^(KXNBA|KXNFL|KXNHL|KXNCAAB|KXNCAAMBG|KXNCAAF)GAME-(\d+)([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;
  
  const sportPrefix = match[1];
  const sport = sportPrefix === 'KXNBA' ? 'NBA' : 
                sportPrefix === 'KXNFL' ? 'NFL' : 
                sportPrefix === 'KXNHL' ? 'NHL' :
                (sportPrefix === 'KXNCAAB' || sportPrefix === 'KXNCAAMBG') ? 'NCAAB' :
                sportPrefix === 'KXNCAAF' ? 'NCAAF' : '';
  const combined = match[3];
  const side = match[4];
  
  // Try to extract team names (simplified - would need full team mapping for accuracy)
  return { sport, teams: combined, side };
}

export function parseTickerToGame(ticker: string): { awayTeam: string; homeTeam: string; teamSide: string; sport: string } | null {
  // Format: KXNFLGAME-25NOV30LACAR-LA or KXNHLGAME-25NOV30TORMTL-TOR
  // or KXNCAABGAME-25NOV30DUKEUNC-DUKE or KXNCAAFGAME-25NOV30ALABAMA-AUB
  // or KXNCAAMBGAME-25NOV30DUKEUNC-DUKE (alternate college basketball prefix)
  // combined = LACAR (LAR + CAR), side = LA (which is LAR)
  const match = ticker.match(/^(KXNBA|KXNFL|KXNHL|KXNCAAB|KXNCAAMBG|KXNCAAF)GAME-(\d+)([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;
  
  const sportPrefix = match[1];
  const sport: 'NBA' | 'NFL' | 'NHL' | 'NCAAB' | 'NCAAF' = sportPrefix === 'KXNBA' ? 'NBA' : 
                sportPrefix === 'KXNFL' ? 'NFL' : 
                sportPrefix === 'KXNHL' ? 'NHL' :
                (sportPrefix === 'KXNCAAB' || sportPrefix === 'KXNCAAMBG') ? 'NCAAB' :
                sportPrefix === 'KXNCAAF' ? 'NCAAF' : 'NBA'; // Default to NBA if unknown
  const combined = match[3];
  const sideAbbrev = match[4];
  
  // Team abbreviation maps
  const nbaTeamAbbrevMap: { [key: string]: string } = {
    'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
    'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GS': 'GS',
    'GSW': 'GS', 'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL',
    'MEM': 'MEM', 'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NO': 'NO',
    'NOP': 'NO', 'NY': 'NY', 'NYK': 'NY', 'OKC': 'OKC', 'ORL': 'ORL',
    'PHI': 'PHI', 'PHX': 'PHX', 'POR': 'POR', 'SAC': 'SAC', 'SA': 'SA',
    'SAS': 'SA', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS', 'WSH': 'WAS'
  };
  
  const nflTeamAbbrevMap: { [key: string]: string } = {
    'ARI': 'ARI', 'ATL': 'ATL', 'BAL': 'BAL', 'BUF': 'BUF', 'CAR': 'CAR',
    'CHI': 'CHI', 'CIN': 'CIN', 'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN',
    'DET': 'DET', 'GB': 'GB', 'HOU': 'HOU', 'IND': 'IND', 'JAX': 'JAX',
    'KC': 'KC', 'LV': 'LV', 'LAR': 'LAR', 'LAC': 'LAC', 'MIA': 'MIA',
    'MIN': 'MIN', 'NE': 'NE', 'NO': 'NO', 'NYG': 'NYG', 'NYJ': 'NYJ',
    'PHI': 'PHI', 'PIT': 'PIT', 'SF': 'SF', 'SEA': 'SEA', 'TB': 'TB',
    'TEN': 'TEN', 'WAS': 'WAS', 'WSH': 'WAS'
  };
  
  const nhlTeamAbbrevMap: { [key: string]: string } = {
    'ANA': 'ANA', 'ARI': 'ARI', 'BOS': 'BOS', 'BUF': 'BUF', 'CGY': 'CGY',
    'CAR': 'CAR', 'CHI': 'CHI', 'COL': 'COL', 'CBJ': 'CBJ', 'DAL': 'DAL',
    'DET': 'DET', 'EDM': 'EDM', 'FLA': 'FLA', 'LA': 'LAK', 'LAK': 'LAK',
    'MIN': 'MIN', 'MTL': 'MTL', 'NSH': 'NSH', 'NJ': 'NJD', 'NJD': 'NJD',
    'NYI': 'NYI', 'NYR': 'NYR', 'OTT': 'OTT', 'PHI': 'PHI', 'PIT': 'PIT',
    'SJ': 'SJS', 'SJS': 'SJS', 'SEA': 'SEA', 'STL': 'STL', 'TB': 'TBL',
    'TBL': 'TBL', 'TOR': 'TOR', 'VAN': 'VAN', 'VGK': 'VGK', 'WAS': 'WSH',
    'WSH': 'WSH', 'WPG': 'WPG'
  };
  
  // For college sports, we don't have a comprehensive team map, so we'll parse directly from ticker
  // College teams have many variations and abbreviations, so we'll be more flexible
  const teamAbbrevMap = sport === 'NFL' ? nflTeamAbbrevMap : 
                       sport === 'NHL' ? nhlTeamAbbrevMap : 
                       sport === 'NCAAB' || sport === 'NCAAF' ? {} : // Empty for college - parse from ticker
                       nbaTeamAbbrevMap;
  
  // Handle partial abbreviations
  const partialToFull: { [key: string]: string } = sport === 'NFL' ? {
    'LA': 'LAR', // Los Angeles Rams
  } : sport === 'NHL' ? {
    'LA': 'LAK', // Los Angeles Kings
    'SJ': 'SJS', // San Jose Sharks
    'NJ': 'NJD', // New Jersey Devils
    'TB': 'TBL', // Tampa Bay Lightning
  } : sport === 'NCAAB' || sport === 'NCAAF' ? {
    // College sports - minimal mapping, will parse from ticker directly
  } : {};
  
  const fullSideAbbrev = partialToFull[sideAbbrev] || sideAbbrev;
  
  // Try to split combined abbreviations
  const possibleSplits = [[3, 3], [3, 4], [4, 3], [3, 2], [2, 3], [4, 4], [2, 4], [4, 2]];
  
  let awayTeam: string | null = null;
  let homeTeam: string | null = null;
  
  for (const [len1, len2] of possibleSplits) {
    if (combined.length >= len1 + len2) {
      const abbrev1 = combined.substring(0, len1);
      const abbrev2 = combined.substring(len1, len1 + len2);
      
      let abbrev1Full = teamAbbrevMap[abbrev1];
      let abbrev2Full = teamAbbrevMap[abbrev2];
      
      // Try partial mapping
      if (!abbrev1Full && partialToFull[abbrev1]) {
        abbrev1Full = teamAbbrevMap[partialToFull[abbrev1]];
      }
      if (!abbrev2Full && partialToFull[abbrev2]) {
        abbrev2Full = teamAbbrevMap[partialToFull[abbrev2]];
      }
      
      // Check prefix matches
      if (!abbrev1Full || !abbrev2Full) {
        for (const [key, value] of Object.entries(teamAbbrevMap)) {
          if (!abbrev1Full && key.startsWith(abbrev1) && key.length <= abbrev1.length + 1) {
            abbrev1Full = value;
          }
          if (!abbrev2Full && key.startsWith(abbrev2) && key.length <= abbrev2.length + 1) {
            abbrev2Full = value;
          }
        }
      }
      
      if (abbrev1Full && abbrev2Full) {
        // Determine which is home/away based on which matches the side abbreviation
        if (abbrev1Full === fullSideAbbrev || abbrev1 === sideAbbrev || abbrev1Full.startsWith(sideAbbrev)) {
          homeTeam = abbrev1Full;
          awayTeam = abbrev2Full;
        } else if (abbrev2Full === fullSideAbbrev || abbrev2 === sideAbbrev || abbrev2Full.startsWith(sideAbbrev)) {
          homeTeam = abbrev2Full;
          awayTeam = abbrev1Full;
        } else {
          // Default: first is away, second is home
          awayTeam = abbrev1Full;
          homeTeam = abbrev2Full;
        }
        break;
      } else if (sport === 'NCAAB' || sport === 'NCAAF') {
        // For college sports, if we can't find in map, use the abbreviations directly
        // This handles cases where college team abbreviations aren't in our map
        if (abbrev1 && abbrev2) {
          // Check which matches the side abbreviation
          if (abbrev1 === sideAbbrev || abbrev1.startsWith(sideAbbrev) || sideAbbrev.startsWith(abbrev1)) {
            homeTeam = abbrev1;
            awayTeam = abbrev2;
          } else if (abbrev2 === sideAbbrev || abbrev2.startsWith(sideAbbrev) || sideAbbrev.startsWith(abbrev2)) {
            homeTeam = abbrev2;
            awayTeam = abbrev1;
          } else {
            // Default: first is away, second is home
            awayTeam = abbrev1;
            homeTeam = abbrev2;
          }
          break;
        }
      }
    }
  }
  
  // Special case for LAARI
  if (!awayTeam && combined === 'LAARI' && sport === 'NFL') {
    awayTeam = 'LAR';
    homeTeam = 'ARI';
  }
  
  if (!awayTeam || !homeTeam) {
    return null;
  }
  
  return { awayTeam, homeTeam, teamSide: fullSideAbbrev, sport };
}


