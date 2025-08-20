# Paper Trails Cleanup Plan

## Current State Analysis
- **10 GitHub Actions workflows** (high chance of conflicts)
- **7 fetch scripts** (redundant functionality)  
- **2 worker files** (potential import issues)
- **Multiple cron schedules** (may run simultaneously)

## Recommended Actions

### 🗑️ Files to Remove:
```bash
# Redundant/conflicting workflows (keep only the new one)
rm .github/workflows/fetch-batch-*.yml     # 6 files
rm .github/workflows/fetch-feeds.yml       # Old main
rm .github/workflows/fetch-feeds-fixed.yml # Old attempt

# Redundant scripts (keep only the new proxy version)  
rm src/scripts/fetch-feeds-via-worker.js   # Duplicate
rm src/scripts/fetch-with-proxy.js         # Old proxy attempt
rm src/scripts/fetch-feeds-parallel.js     # Complex batch system

# Test files
rm test-worker-proxy.js                    # One-time test
```

### 🔧 Files to Keep & Use:
```bash
# Core functionality
src/scripts/fetch-feeds.js                 # Fallback for direct fetch
src/scripts/fetch-feeds-with-proxy.js      # NEW - Main solution
src/scripts/enhanced-logger.js             # Logging utility

# Workflows  
.github/workflows/fetch-feeds-proxy.yml    # NEW - Main workflow
.github/workflows/deploy.yml               # Keep for site deployment

# Worker setup
functions/rss-proxy.js                     # NEW - RSS proxy
functions/_worker.js                       # Keep but needs fix
```

### 🛠️ Required Fixes:

#### 1. Fix Worker Import Issue:
```javascript
// functions/_worker.js currently has:
import rssProxy from './rss-proxy.js';  // ❌ May fail in CF Pages

// Should be inline or use different approach
```

#### 2. Update package.json Scripts:
```json
{
  "fetch-feeds": "node src/scripts/fetch-feeds-with-proxy.js", // Update main
  "fetch-feeds-direct": "node src/scripts/fetch-feeds.js"      // Fallback
}
```

#### 3. Disable Conflicting Workflows:
- Rename old workflows to `.yml.disabled` 
- Or delete them entirely

## Migration Strategy:

### Phase 1: Disable Conflicts
1. Rename old workflows to `.disabled`
2. Test new workflow manually  
3. Monitor success rates

### Phase 2: Clean Up (once proven working)
1. Delete redundant files
2. Update documentation
3. Simplify package.json scripts

### Phase 3: Optimize (optional)
1. Combine worker files properly
2. Add error recovery mechanisms
3. Fine-tune delays/timeouts

## Risk Assessment:
- **Low Risk**: Removing unused scripts
- **Medium Risk**: Disabling old workflows (can re-enable)
- **High Risk**: Modifying worker structure (test locally first)

## Rollback Plan:
- Keep old workflows as `.disabled` initially  
- Git history preserves all deleted files
- Can revert to any previous approach if needed