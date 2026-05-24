import { Router } from 'express';
import { usersRouter } from './users.js';
import { accountsRouter } from './accounts.js';
import { categoriesRouter } from './categories.js';
import { transactionsRouter } from './transactions.js';
import { budgetsRouter } from './budgets.js';
import { dashboardRouter } from './dashboard.js';

export const apiRouter = Router();
apiRouter.use(usersRouter);
apiRouter.use(accountsRouter);
apiRouter.use(categoriesRouter);
apiRouter.use(transactionsRouter);
apiRouter.use(budgetsRouter);
apiRouter.use(dashboardRouter);
