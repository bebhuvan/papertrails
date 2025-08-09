# Feed Fetching Strategy Documentation

## Problem Statement
RSS feed fetching was experiencing high failure rates due to Substack's anti-bot protection:
- 403 Forbidden errors on ~40% of Substack feeds
- Rate limiting detection blocking requests
- Aggressive retry patterns making the problem worse

## Current Solution: Smart Domain-Based Rate Limiting

### Implementation Details
Located in: `src/scripts/fetch-feeds.js`

#### Key Features:
1. **Domain-Based Tracking**
   - Tracks last request time per domain
   - 10-minute minimum between requests to same domain
   - Prevents hammering individual servers

2. **Service-Specific Delays**
   - Substack feeds: 2-5 minute randomized delays
   - Non-Substack feeds: 15 second delays
   - Mimics human browsing patterns

3. **Sequential Processing**
   - One feed at a time (no batching)
   - 30-second base delay between all requests
   - Randomized feed order to distribute load

4. **Conservative Settings**
   - Reduced retry attempts (2 instead of 3)
   - Increased timeouts (45 seconds)
   - Better error handling and logging

#### Configuration:
```javascript
const RATE_LIMIT = {
  minDelayBetweenDomainRequests: 10 * 60 * 1000, // 10 minutes
  substackDelayMin: 2 * 60 * 1000, // 2 minutes minimum
  substackDelayMax: 5 * 60 * 1000, // 5 minutes maximum  
  nonSubstackDelay: 15000, // 15 seconds
  delayBetweenRequests: 30000, // 30 seconds base delay
  retryAttempts: 2,
  retryDelay: 15000
};
```

#### Expected Performance:
- **Time**: ~6 hours for 118 feeds (very conservative)
- **Success Rate**: Should eliminate most 403 errors
- **Resource Usage**: Minimal (single workflow)

## Alternative Approaches Considered

### 1. Paid Proxy Services
**Pros**: Most effective against rate limiting
**Cons**: $10-500/month cost, complex integration
**Decision**: Rejected due to cost constraints

### 2. Free Proxy Rotation  
**Pros**: No cost
**Cons**: Unreliable, high failure rates, complex error handling
**Decision**: Rejected due to reliability concerns

### 3. Multiple Parallel Workflows
**Idea**: Split feeds across 5-6 separate GitHub Actions workflows
**Pros**: 5-6x faster processing, natural IP distribution
**Cons**: 
- GitHub Actions concurrent workflow limits
- Potential IP range detection (all from GitHub)
- Git merge conflicts from parallel writes
- Added complexity vs uncertain benefits
**Decision**: Deferred - test current solution first

### 4. Browser Automation (Puppeteer/Playwright)
**Pros**: Most realistic request patterns
**Cons**: Much slower, complex setup, higher resource usage
**Decision**: Rejected as overkill for RSS feeds

### 5. RSS Aggregator APIs
**Pros**: Professional handling of rate limits
**Cons**: $29-99/month cost
**Decision**: Rejected due to cost constraints

## Free Alternatives Tested

### Previous Attempts:
1. **Basic Rate Limiting** - Still too aggressive
2. **User Agent Rotation** - Helped slightly but insufficient  
3. **Request Header Improvements** - Marginal improvement
4. **Batch Size Reduction** - Reduced but didn't eliminate 403s

## Monitoring and Maintenance

### Success Metrics:
- 403 error rate < 10% (target: < 5%)
- Total successful feeds > 90%
- Completion time < 8 hours

### Warning Signs:
- 403 error rate increasing
- New patterns of failures
- Timeouts increasing

### Future Optimizations:
If current approach fails:
1. Increase delays further (5-10 minute minimums)
2. Implement failed feed rotation (skip recently failed feeds)
3. Consider proxy services if budget allows
4. Revisit multi-workflow approach with better conflict resolution

## Implementation Notes

### Git Integration:
- Single commit after all feeds processed
- Atomic updates to avoid conflicts
- Archive system maintains historical data

### Error Handling:
- Continue processing even if individual feeds fail
- Detailed logging for troubleshooting
- Graceful degradation

### Monitoring:
- Track domain request patterns
- Log wait times and success rates
- Archive failed feeds for analysis

## Lessons Learned

1. **Respect beats speed**: Conservative approach more successful than aggressive optimization
2. **Domain awareness crucial**: Treating all feeds equally caused problems
3. **Randomization helps**: Predictable patterns trigger detection
4. **Simple solutions preferred**: Complex approaches add maintenance burden
5. **Free constraints drive creativity**: Working within GitHub Actions limits led to better design

---

**Last Updated**: August 2025
**Current Status**: Smart rate limiting implemented, testing in progress
**Next Review**: After 1 week of production use