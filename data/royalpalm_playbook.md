# Royal Palm Pool Service: route playbook

Royal Palm Pool Service is a fictional pool company made up for Build Night. Tomás Rivera owns it. Three techs each run a route Monday to Friday:

- **Jenny**: Coral Gables
- **Omar**: South Miami
- **Raúl**: Pinecrest

At every stop the tech tests the water and logs it in `royalpalm_readings.csv`. Pool details and billing are in `royalpalm_pools.csv`.

Today is **Monday, October 26, 2026, 7:00 AM**. The readings file has last week's visits, Monday October 19 to Friday October 23. Nobody has reviewed them.

Your job is Monday's extra work: which pools need a revisit today, what chemicals each truck needs, what goes to Tomás, and which customers get a text.

Give every pool one status: **OK**, **Dose at next visit**, **Revisit today**, **Tomás**, or **Data flag**. List any other findings with it. A pool's next visit is its regular route day.

## Target ranges

- Free chlorine (FC): 3 to 5 ppm
- pH: 7.4 to 7.6. Act when it is below 7.2 or above 7.8.
- Total alkalinity: 80 to 120 ppm
- Cyanuric acid (CYA, stabilizer): 30 to 80 ppm
- Salt, saltwater pools only: 3,000 to 3,800 ppm

Outside a range with no rule below, note it for the next visit. There is no Monday dose.

## Revisits

A pool needs a revisit today when any of these is true:

- FC is below 1.0
- The water is green or cloudy
- The tech couldn't service it last week. That is a make-up visit.

When FC is below 1.0 or the water is green or cloudy, the pool isn't safe to swim in until the revisit. Text the customer. For a make-up visit, text them that we'll be there today, and don't say why we missed it.

## Doses

**Chlorine.** One gallon of 10% liquid chlorine raises FC by 10 ppm in 10,000 gallons.

- Dose any pool below 3 ppm at its next visit, or at today's revisit. Raise it to 5 ppm. For green water, shock to 10 ppm instead.
- Gallons of chlorine = (target − FC) × (pool gallons ÷ 10,000) ÷ 10. Round up to the next half gallon.

**Acid.** One quart of muriatic acid lowers pH by about 0.2 in 10,000 gallons. Dose only when pH is above 7.8, and bring it to 7.5.

- Quarts = (pH − 7.5) ÷ 0.2 × (pool gallons ÷ 10,000). Round up to the next whole quart.

**Salt.** One 40 lb bag raises salt by about 480 ppm in 10,000 gallons. When a salt pool reads below 2,800, bring it to 3,400. Between 2,800 and 3,000, no dose.

- Bags = (3,400 − salt) ÷ 480 × (pool gallons ÷ 10,000). Round up. Salt bills to the customer at $12 a bag.

## Other problems

- **High stabilizer.** CYA above 100 needs a partial drain and refill. It costs the customer $175 and needs their OK first. Text to ask.
- **Equipment.** Any tech note about a problem with a pump, filter, heater, salt cell, or a leak goes to Tomás for a repair quote. Routine cleaning and warning lights about chemistry aren't problems. Never quote a repair price to a customer.

## Capacity

Each tech can add **at most 3 extra stops** on Monday. Revisits go to the pool's own tech first. When a tech has more than 3, move the least urgent stop (make-up visits first) to the tech with the fewest extra stops. Chemicals travel with the stop. Every revisit happens Monday.

## Bad data

- Residential pools here hold 8,000 to 40,000 gallons. Flag anything outside that range, and don't dose from it.
- pH readings outside 6.0 to 9.0 are typos. Flag them for a retest at the next regular visit, and don't dose. A flagged pool is not an extra stop.

## Texting customers

Text in the customer's language from `royalpalm_pools.csv`. Short and specific: what we found, what happens next, and when. Never blame the customer. Sign as "Royal Palm Pool Service". Your app can't send texts tonight. Draft them and show who they go to.
